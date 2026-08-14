import "./loadEnv";
import { assertShadowMode } from "../src/lib/env";
import { getMailboxes } from "../src/lib/mailboxes";
import { deltaInbox } from "../src/lib/graph";
import { processMessage } from "../src/lib/pipeline";
import { prisma } from "../src/lib/prisma";

// Delta-query backstop (spec §5): notifications aren't guaranteed, so sweep each
// inbox on a timer (every ~15 min) and process anything the webhook missed.
// Dedupe is handled by processMessage (idempotent on graphMessageId).
async function main() {
  assertShadowMode();

  for (const mb of getMailboxes()) {
    try {
      const state = await prisma.deltaState.findUnique({
        where: { mailbox: mb.role },
      });
      const cursor = state?.deltaLink ?? null;
      const { messages, deltaLink } = await deltaInbox(mb.address, cursor);

      // Safety: with no saved cursor, Graph returns the ENTIRE inbox history.
      // Never classify that backlog (it would burn credits). Instead behave like
      // `prime`: store the cursor and process nothing. From the next run on, only
      // genuinely new mail arrives. This removes the deploy-order race entirely.
      if (!cursor) {
        if (deltaLink) {
          await prisma.deltaState.upsert({
            where: { mailbox: mb.role },
            create: { mailbox: mb.role, deltaLink },
            update: { deltaLink },
          });
        }
        console.log(
          `✓ delta ${mb.role}: not primed — stored cursor past ${messages.length} existing, processed 0`
        );
        continue;
      }

      let processed = 0;
      for (const msg of messages) {
        if (!msg.id) continue;
        const res = await processMessage(mb.role, msg).catch((e) => {
          console.error(`[delta] failed ${mb.role}/${msg.id}:`, (e as Error).message);
          return { created: false };
        });
        if (res.created) processed++;
      }

      if (deltaLink) {
        await prisma.deltaState.upsert({
          where: { mailbox: mb.role },
          create: { mailbox: mb.role, deltaLink },
          update: { deltaLink },
        });
      }
      console.log(`✓ delta ${mb.role}: ${messages.length} seen, ${processed} new`);
    } catch (e) {
      console.error(`✗ delta failed ${mb.role}:`, (e as Error).message);
      process.exitCode = 1;
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
