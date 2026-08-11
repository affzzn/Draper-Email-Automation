import "./loadEnv";
import { assertShadowMode, env } from "../src/lib/env";
import { getMailboxes } from "../src/lib/mailboxes";
import {
  renewSubscription,
  createSubscription,
  listSubscriptions,
} from "../src/lib/graph";
import { prisma } from "../src/lib/prisma";

// Renew all subscriptions well inside the <3-day expiry (spec §5). Run on a cron
// (e.g. every 6 hours). Recreates any that have gone missing, and alerts on failure.
async function main() {
  assertShadowMode();
  const notificationUrl = `${env.publicUrl}/api/graph/notifications`;
  const lifecycleUrl = `${env.publicUrl}/api/graph/lifecycle`;

  let liveIds: string[] = [];
  try {
    liveIds = (await listSubscriptions()).map((s) => s.id);
  } catch (e) {
    console.warn("Could not list live subscriptions:", (e as Error).message);
  }

  for (const mb of getMailboxes()) {
    const local = await prisma.subscription.findFirst({
      where: { mailbox: mb.role },
      orderBy: { createdAt: "desc" },
    });

    const stillLive = local && liveIds.includes(local.id);

    if (stillLive) {
      try {
        const sub = await renewSubscription(local!.id);
        await prisma.subscription.update({
          where: { id: local!.id },
          data: { expiresAt: new Date(sub.expirationDateTime) },
        });
        console.log(`✓ renewed ${mb.role} — expires ${sub.expirationDateTime}`);
        continue;
      } catch (e) {
        console.error(`⚠ renew failed for ${mb.role}, recreating:`, (e as Error).message);
      }
    }

    // Missing or renew failed → recreate.
    try {
      const sub = await createSubscription(
        mb.address,
        notificationUrl,
        lifecycleUrl,
        env.graphClientState
      );
      if (local) await prisma.subscription.delete({ where: { id: local.id } }).catch(() => {});
      await prisma.subscription.create({
        data: {
          id: sub.id,
          mailbox: mb.role,
          resource: sub.resource,
          expiresAt: new Date(sub.expirationDateTime),
          clientState: env.graphClientState,
          notificationUrl,
        },
      });
      console.log(`✓ recreated ${mb.role} — expires ${sub.expirationDateTime}`);
    } catch (e) {
      console.error(`✗ ALERT: could not (re)create subscription for ${mb.role}:`, (e as Error).message);
      process.exitCode = 1;
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
