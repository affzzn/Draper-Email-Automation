import "./loadEnv";
import { assertShadowMode } from "../src/lib/env";
import { prisma } from "../src/lib/prisma";

// End-of-week report (spec §11). Prints the go/no-go inputs for phase 2.
// Human-reply-time and reply-all metrics need live Graph access; where the raw
// data isn't present they are reported as "not captured" rather than guessed.
function pct(n: number, d: number): string {
  return d === 0 ? "—" : `${((n / d) * 100).toFixed(1)}%`;
}

async function main() {
  assertShadowMode();
  const all = await prisma.enquiry.findMany({ include: { decision: true } });
  const n = all.length;

  console.log("\n══════════════════════════════════════════════════════════");
  console.log("  DRAPER LONDON — SHADOW WEEK REPORT");
  console.log("══════════════════════════════════════════════════════════\n");
  console.log(`Total enquiries: ${n}\n`);

  // 1. Volume per mailbox per day, by source
  console.log("── Volume per mailbox × source ──");
  const vol: Record<string, number> = {};
  for (const e of all) {
    const key = `${e.mailbox} / ${e.source}`;
    vol[key] = (vol[key] ?? 0) + 1;
  }
  Object.entries(vol).sort().forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  // 2. Intent distribution per mailbox
  console.log("\n── Intent distribution per mailbox ──");
  const intents: Record<string, number> = {};
  for (const e of all) {
    const key = `${e.mailbox} / ${e.intent ?? "null"}`;
    intents[key] = (intents[key] ?? 0) + 1;
  }
  Object.entries(intents).sort().forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  // 3. Classification accuracy + FALSE POSITIVES on viewing_request
  console.log("\n── Classification accuracy (graded set) ──");
  const graded = all.filter((e) => e.gradedClassificationCorrect !== null);
  const correct = graded.filter((e) => e.gradedClassificationCorrect === true).length;
  console.log(`  Graded: ${graded.length} / ${n}`);
  console.log(`  Correct: ${correct} (${pct(correct, graded.length)})`);
  const viewingGradedWrong = graded.filter(
    (e) => e.intent === "viewing_request" && e.gradedClassificationCorrect === false
  ).length;
  const viewingGraded = graded.filter((e) => e.intent === "viewing_request").length;
  console.log(
    `  ⚠ FALSE POSITIVES on viewing_request: ${viewingGradedWrong} of ${viewingGraded} graded viewing_requests (${pct(viewingGradedWrong, viewingGraded)})`
  );
  console.log("    ↳ This is the number that decides whether auto-send is safe.");

  // 4. Parse success rate + which fields fail
  console.log("\n── Parse success ──");
  const byStatus: Record<string, number> = { full: 0, partial: 0, failed: 0 };
  const fieldFail: Record<string, number> = {};
  for (const e of all) {
    byStatus[e.parseStatus] = (byStatus[e.parseStatus] ?? 0) + 1;
    for (const note of e.parseNotes) {
      const field = note.split(":")[0];
      if (/not found|could not|no /.test(note)) fieldFail[field] = (fieldFail[field] ?? 0) + 1;
    }
  }
  console.log(`  full: ${byStatus.full} · partial: ${byStatus.partial} · failed: ${byStatus.failed}`);
  console.log("  Most-failing fields:");
  Object.entries(fieldFail).sort((a, b) => b[1] - a[1]).forEach(([f, c]) => console.log(`    ${f}: ${c}`));

  // 5. Applicant email resolution: header vs reply-to vs body
  console.log("\n── Applicant email resolution ──");
  const res: Record<string, number> = {};
  for (const e of all) res[e.emailResolvedFrom] = (res[e.emailResolvedFrom] ?? 0) + 1;
  Object.entries(res).forEach(([k, v]) => console.log(`  ${k}: ${v} (${pct(v, n)})`));

  // 6. Reply-direct vs reply-all on human replies
  console.log("\n── Reply-direct vs reply-all (human replies) ──");
  const withFlag = all.filter((e) => e.isReplyAllRequired !== null);
  if (withFlag.length === 0) {
    console.log("  not captured — requires sent-items thread analysis (see README §human-replies)");
  } else {
    const all_ = withFlag.filter((e) => e.isReplyAllRequired === true).length;
    console.log(`  reply-all: ${all_} · direct: ${withFlag.length - all_}`);
  }

  // 7. Time from receipt to human first reply (THE baseline)
  console.log("\n── Time to first human reply (baseline) ──");
  console.log("  not captured automatically in v1 — populate via sent-items analysis.");
  console.log("  ↳ Row 7 of §11: the baseline the whole project is measured against.");

  // 8. Send-window policy difference on real traffic
  console.log("\n── Send-window policy difference ──");
  const held = all.filter(
    (e) =>
      e.decision?.wouldSendAtImmediate &&
      e.decision?.wouldSendAtHeld &&
      e.decision.wouldSendAtImmediate.getTime() !== e.decision.wouldSendAtHeld.getTime()
  );
  console.log(`  Enquiries where the 05:30 hold changes send time: ${held.length} (${pct(held.length, n)})`);
  const totalDelayMin = held.reduce(
    (acc, e) =>
      acc +
      (e.decision!.wouldSendAtHeld!.getTime() - e.decision!.wouldSendAtImmediate!.getTime()) /
        60000,
    0
  );
  console.log(`  Avg added delay under hold policy: ${held.length ? (totalDelayMin / held.length).toFixed(0) : 0} min`);

  // Eligibility & suppression summary
  console.log("\n── Eligibility & suppression ──");
  const eligible = all.filter((e) => e.decision?.eligible).length;
  const suppressed = all.filter((e) => e.decision?.suppressed).length;
  const generated = all.filter((e) => e.decision?.generatedBody).length;
  console.log(`  eligible: ${eligible} · suppressed: ${suppressed} · drafts generated: ${generated}`);

  console.log("\n══════════════════════════════════════════════════════════\n");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
