import { assertShadowMode, env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { fetchMessage } from "@/lib/graph";
import { processMessage } from "@/lib/pipeline";
import { mailboxByRole } from "@/lib/mailboxes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

assertShadowMode();

interface GraphNotification {
  subscriptionId: string;
  clientState?: string;
  resource?: string;
  resourceData?: { id?: string };
}

// Handle the two things Graph sends here:
// 1) Subscription-creation validation: a POST with ?validationToken=... — echo it
//    back as text/plain within 10 seconds (spec §5).
// 2) Change notifications: { value: [...] }. Validate clientState, ack fast (202),
//    then fetch + process each message off the response path.
export async function POST(req: Request) {
  const url = new URL(req.url);
  const validationToken = url.searchParams.get("validationToken");
  if (validationToken) {
    return new Response(validationToken, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  const payload = await req.json().catch(() => null);
  const notifications: GraphNotification[] = payload?.value ?? [];

  // Validate clientState on every notification before trusting anything.
  const valid = notifications.filter(
    (n) => n.clientState === env.graphClientState && n.resourceData?.id
  );

  // Acknowledge immediately; process in the background (persistent Node server).
  processNotifications(valid).catch((e) =>
    console.error("[notifications] processing error:", e)
  );

  return new Response(null, { status: 202 });
}

async function processNotifications(notifications: GraphNotification[]) {
  for (const n of notifications) {
    try {
      const sub = await prisma.subscription.findUnique({
        where: { id: n.subscriptionId },
        select: { mailbox: true },
      });
      if (!sub) {
        console.warn("[notifications] unknown subscription", n.subscriptionId);
        continue;
      }
      const address = mailboxByRole(sub.mailbox).address;
      const message = await fetchMessage(address, n.resourceData!.id!);
      const result = await processMessage(sub.mailbox, message);
      if (result.created) {
        console.log(`[notifications] processed ${sub.mailbox} / ${message.id}`);
      }
    } catch (e) {
      console.error("[notifications] item failed:", e);
    }
  }
}
