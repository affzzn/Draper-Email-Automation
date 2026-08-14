import "./loadEnv";
import { assertShadowMode } from "../src/lib/env";
import { getMailboxes } from "../src/lib/mailboxes";
import { deltaInbox } from "../src/lib/graph";
import { prisma } from "../src/lib/prisma";

// Prime the delta cursor to "now" WITHOUT processing the existing backlog.
// Run this ONCE at go-live. It pages through the current inbox to obtain Graph's
// delta link (fetching only ids, no Claude, no writes), then saves it. Every poll
// afterwards returns ONLY mail that arrived after this point, so the historical
// backlog is never classified and no credits are spent on it.
async function main() {
  assertShadowMode();
  console.log("Priming delta cursors (no emails processed, no Claude calls)…\n");

  for (const mb of getMailboxes()) {
    try {
      const { messages, deltaLink } = await deltaInbox(mb.address, null);
      if (!deltaLink) {
        console.warn(`✗ ${mb.role}: no delta link returned`);
        continue;
      }
      await prisma.deltaState.upsert({
        where: { mailbox: mb.role },
        create: { mailbox: mb.role, deltaLink },
        update: { deltaLink },
      });
      console.log(
        `✓ ${mb.role.padEnd(9)} primed past ${messages.length} existing emails — only new mail is processed from now`
      );
    } catch (e) {
      console.error(`✗ ${mb.role}: ${(e as Error).message}`);
      process.exitCode = 1;
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
