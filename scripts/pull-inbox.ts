import "./loadEnv";
import { assertShadowMode } from "../src/lib/env";
import { getMailboxes } from "../src/lib/mailboxes";
import { recentInboxMessages } from "../src/lib/graph";
import { processMessage } from "../src/lib/pipeline";
import { prisma } from "../src/lib/prisma";

// Pull REAL recent inbox messages (read-only) and run them through the full shadow
// pipeline. Bounded on purpose so the first real run doesn't classify years of mail.
//   npm run pull            → last 7 days, up to 25 per inbox
//   npm run pull -- 30 50   → last 30 days, up to 50 per inbox
async function main() {
  assertShadowMode();

  const days = Number(process.argv[2] ?? 7);
  const top = Number(process.argv[3] ?? 25);
  const since =
    days > 0 ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString() : null;

  console.log(
    `Pulling real mail (READ-ONLY, no send): last ${days} day(s), up to ${top} per inbox.\n`
  );

  let totalNew = 0;
  for (const mb of getMailboxes()) {
    try {
      const messages = await recentInboxMessages(mb.address, top, since);
      let created = 0;
      for (const msg of messages) {
        if (!msg.id) continue;
        const res = await processMessage(mb.role, msg).catch((e) => {
          console.error(`  ! ${mb.role}/${msg.id}: ${(e as Error).message}`);
          return { created: false };
        });
        if (res.created) created++;
      }
      totalNew += created;
      console.log(`✓ ${mb.role.padEnd(9)} ${messages.length} fetched, ${created} new enquiries`);
    } catch (e) {
      console.error(`✗ ${mb.role.padEnd(9)} FAILED: ${(e as Error).message}`);
    }
  }

  console.log(`\n${totalNew} new enquiries processed. Open http://localhost:3000 to review.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
