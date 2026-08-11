import "./loadEnv";
import { assertShadowMode, env } from "../src/lib/env";
import { getMailboxes } from "../src/lib/mailboxes";
import {
  createSubscription,
  listSubscriptions,
  deleteSubscription,
} from "../src/lib/graph";
import { prisma } from "../src/lib/prisma";

// Create (or refresh) one Graph subscription per mailbox. Run once after deploy,
// and any time PUBLIC_URL changes. Idempotent: clears stale subs for our URL first.
async function main() {
  assertShadowMode();

  const notificationUrl = `${env.publicUrl}/api/graph/notifications`;
  const lifecycleUrl = `${env.publicUrl}/api/graph/lifecycle`;
  const clientState = env.graphClientState;

  console.log("Notification URL:", notificationUrl);

  // Remove any existing subscriptions pointing at our notification URL to avoid dupes.
  try {
    const existing = await listSubscriptions();
    for (const s of existing) {
      if (s.notificationUrl === notificationUrl) {
        await deleteSubscription(s.id).catch(() => {});
        await prisma.subscription.delete({ where: { id: s.id } }).catch(() => {});
      }
    }
  } catch (e) {
    console.warn("Could not list existing subscriptions:", (e as Error).message);
  }

  for (const mb of getMailboxes()) {
    try {
      const sub = await createSubscription(
        mb.address,
        notificationUrl,
        lifecycleUrl,
        clientState
      );
      await prisma.subscription.upsert({
        where: { id: sub.id },
        create: {
          id: sub.id,
          mailbox: mb.role,
          resource: sub.resource,
          expiresAt: new Date(sub.expirationDateTime),
          clientState,
          notificationUrl,
        },
        update: {
          expiresAt: new Date(sub.expirationDateTime),
          notificationUrl,
        },
      });
      console.log(`✓ subscribed ${mb.role} (${mb.address}) — expires ${sub.expirationDateTime}`);
    } catch (e) {
      console.error(`✗ failed to subscribe ${mb.role} (${mb.address}):`, (e as Error).message);
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
