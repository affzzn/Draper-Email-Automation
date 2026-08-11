import { prisma } from "@/lib/prisma";
import { toCsv } from "@/lib/csv";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

const COLUMNS = [
  "id",
  "receivedAt",
  "mailbox",
  "source",
  "applicantName",
  "applicantEmail",
  "emailResolvedFrom",
  "applicantPhone",
  "propertyReference",
  "propertyAddress",
  "propertyUrl",
  "intent",
  "confidence",
  "parseStatus",
  "parseNotes",
  "eligible",
  "ineligibleReason",
  "suppressed",
  "suppressionReason",
  "duplicateOf",
  "wouldSendAtImmediate",
  "wouldSendAtHeld",
  "generatedBody",
  "gradedClassificationCorrect",
  "gradingNote",
];

export async function GET(req: Request) {
  const url = new URL(req.url);
  const where: Prisma.EnquiryWhereInput = {};
  const mailbox = url.searchParams.get("mailbox");
  const intent = url.searchParams.get("intent");
  const parseStatus = url.searchParams.get("parseStatus");
  const eligible = url.searchParams.get("eligible");
  if (mailbox) where.mailbox = mailbox as Prisma.EnquiryWhereInput["mailbox"];
  if (intent) where.intent = intent as Prisma.EnquiryWhereInput["intent"];
  if (parseStatus)
    where.parseStatus = parseStatus as Prisma.EnquiryWhereInput["parseStatus"];
  if (eligible === "yes") where.decision = { eligible: true };
  if (eligible === "no") where.decision = { eligible: false };

  const rows = await prisma.enquiry.findMany({
    where,
    include: { decision: true },
    orderBy: { receivedAt: "desc" },
  });

  const flat = rows.map((e) => ({
    id: e.id,
    receivedAt: e.receivedAt.toISOString(),
    mailbox: e.mailbox,
    source: e.source,
    applicantName: e.applicantName,
    applicantEmail: e.applicantEmail,
    emailResolvedFrom: e.emailResolvedFrom,
    applicantPhone: e.applicantPhone,
    propertyReference: e.propertyReference,
    propertyAddress: e.propertyAddress,
    propertyUrl: e.propertyUrl,
    intent: e.intent,
    confidence: e.confidence,
    parseStatus: e.parseStatus,
    parseNotes: e.parseNotes.join(" | "),
    eligible: e.decision?.eligible ?? "",
    ineligibleReason: e.decision?.ineligibleReason ?? "",
    suppressed: e.decision?.suppressed ?? "",
    suppressionReason: e.decision?.suppressionReason ?? "",
    duplicateOf: e.decision?.duplicateOf ?? "",
    wouldSendAtImmediate: e.decision?.wouldSendAtImmediate?.toISOString() ?? "",
    wouldSendAtHeld: e.decision?.wouldSendAtHeld?.toISOString() ?? "",
    generatedBody: e.decision?.generatedBody ?? "",
    gradedClassificationCorrect: e.gradedClassificationCorrect,
    gradingNote: e.gradingNote,
  }));

  const csv = toCsv(flat, COLUMNS);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="draper-shadow-export.csv"`,
    },
  });
}
