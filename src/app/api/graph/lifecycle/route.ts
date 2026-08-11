import { assertShadowMode, env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { renewSubscription } from "@/lib/graph";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

assertShadowMode();

interface LifecycleNotification {
  subscriptionId: string;
  lifecycleEvent: "reauthorizationRequired" | "subscriptionRemoved" | "missed";
  clientState?: string;
}

// Graph lifecycle notifications (spec §5): handle reauthorizationRequired and
// subscriptionRemoved. Also echoes the validation handshake.
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
  const events: LifecycleNotification[] = payload?.value ?? [];

  handleLifecycle(events).catch((e) =>
    console.error("[lifecycle] error:", e)
  );

  return new Response(null, { status: 202 });
}

async function handleLifecycle(events: LifecycleNotification[]) {
  for (const ev of events) {
    if (ev.clientState && ev.clientState !== env.graphClientState) continue;
    if (
      ev.lifecycleEvent === "reauthorizationRequired" ||
      ev.lifecycleEvent === "missed"
    ) {
      try {
        const sub = await renewSubscription(ev.subscriptionId);
        await prisma.subscription.update({
          where: { id: ev.subscriptionId },
          data: { expiresAt: new Date(sub.expirationDateTime) },
        });
        console.log(`[lifecycle] reauthorised ${ev.subscriptionId}`);
      } catch (e) {
        console.error(`[lifecycle] reauth failed ${ev.subscriptionId}`, e);
      }
    } else if (ev.lifecycleEvent === "subscriptionRemoved") {
      // Remove locally; the renew cron will recreate it on its next run.
      await prisma.subscription
        .delete({ where: { id: ev.subscriptionId } })
        .catch(() => {});
      console.warn(`[lifecycle] subscription removed ${ev.subscriptionId}`);
    }
  }
}
