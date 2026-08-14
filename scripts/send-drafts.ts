import "./loadEnv";
import { prisma } from "../src/lib/prisma";
import { GraphTransport } from "../src/lib/transport";
import { isAllowlisted, sendMode } from "../src/lib/allowlist";
import { mailboxByRole } from "../src/lib/mailboxes";

// Sender worker — the ONLY place a real reply is sent. Deliberately does NOT call
// assertShadowMode (that guards the drafting path). Sending is gated by four
// independent checks (SEND_MODE, hardcoded floor, SEND_ALLOWLIST env, and a
// re-check inside GraphTransport) and each draft is sent at most once (sentAt guard).
//
// Runs on a ~2-min cron. A draft becomes due 6 minutes after the enquiry arrived
// (Decision.wouldSendAtImmediate), giving an abort window: suspend this cron and
// nothing goes out.
async function main() {
  const mode = sendMode();
  if (mode === "off") {
    console.log("SEND_MODE is off (or unset) — sending disabled, nothing to do.");
    await prisma.$disconnect();
    return;
  }
  console.log(`SEND_MODE=${mode} — scanning for due drafts…`);

  const now = new Date();
  const due = await prisma.decision.findMany({
    where: {
      sentAt: null,
      eligible: true,
      suppressed: false,
      duplicateOf: null,
      generatedBody: { not: null },
      wouldSendAtImmediate: { lte: now },
      OR: [{ sendStatus: null }, { sendStatus: "pending" }],
    },
    include: {
      enquiry: {
        select: {
          id: true,
          mailbox: true,
          graphMessageId: true,
          applicantEmail: true,
          isReplyAllRequired: true,
          propertyAddress: true,
          propertyReference: true,
        },
      },
    },
  });

  console.log(`Found ${due.length} due draft(s).`);
  let sent = 0,
    blocked = 0,
    wouldSend = 0,
    errored = 0;

  for (const d of due) {
    const e = d.enquiry;
    const to = e.applicantEmail;

    // Gate: allowlist. Anyone not allowlisted is recorded as blocked and never sent.
    if (!isAllowlisted(to)) {
      await prisma.decision.update({
        where: { id: d.id },
        data: { sendStatus: "blocked" },
      });
      blocked++;
      console.log(`  ⛔ blocked ${e.mailbox}/${e.id} — ${to ?? "(no email)"} not allowlisted`);
      continue;
    }

    if (mode === "dry") {
      wouldSend++;
      console.log(`  🧪 would send to ${to} (${e.mailbox}/${e.id}) — dry run, nothing sent`);
      continue; // leave row pending so it sends once switched to live
    }

    // live: atomically claim the row so a concurrent run can't double-send.
    const claim = await prisma.decision.updateMany({
      where: { id: d.id, sentAt: null, OR: [{ sendStatus: null }, { sendStatus: "pending" }] },
      data: { sendStatus: "sending" },
    });
    if (claim.count !== 1) {
      console.log(`  ↩︎ skip ${e.id} — already claimed by another run`);
      continue;
    }

    const mailboxAddress = mailboxByRole(e.mailbox).address;
    const subject = `Re: ${e.propertyAddress ?? e.propertyReference ?? "your enquiry"}`;

    try {
      const result = await new GraphTransport().send({
        enquiryId: e.id,
        toEmail: to,
        subject,
        body: d.generatedBody as string,
        sendAt: d.wouldSendAtImmediate,
        mailboxAddress,
        originalMessageId: e.graphMessageId,
        replyAll: e.isReplyAllRequired === true,
      });
      await prisma.decision.update({
        where: { id: d.id },
        data: {
          sentAt: new Date(),
          sendStatus: "sent",
          sendResult: result.record as unknown as object,
        },
      });
      sent++;
      console.log(`  ✅ sent to ${to} (${e.mailbox}/${e.id}) — reply ${result.record.graphReplyId}`);
    } catch (err) {
      const msg = (err as Error).message;
      await prisma.decision.update({
        where: { id: d.id },
        data: { sendStatus: "error", sendError: msg },
      });
      errored++;
      console.error(`  ✗ error sending ${e.id} to ${to}: ${msg}`);
    }
  }

  console.log(
    `Done. sent=${sent} blocked=${blocked} wouldSend=${wouldSend} error=${errored}`
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
