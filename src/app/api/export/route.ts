import { toCsv } from "@/lib/csv";
import { getEnquiryRows } from "@/lib/store";
import { defaultAssignee } from "@/lib/assignees";

export const dynamic = "force-dynamic";

// Curated, well-ordered columns. Leads with identity and what the applicant said,
// then the decision + reason, then the outputs (draft reply, alternatives), grading,
// and finally the full incoming email. No duplicate/noisy internal fields.
const COLUMNS = [
  "enquiryId",
  "received",
  "mailbox",
  "source",
  "applicantName",
  "applicantEmail",
  "applicantPhone",
  "property",
  "propertyReference",
  "applicantMessage",
  "budget",
  "requirements",
  "interestedIn",
  "aboutApplicant",
  "intent",
  "confidence",
  "factualQuestion",
  "parseStatus",
  "parseNotes",
  "eligible",
  "eligibilityReason",
  "suppressed",
  "suppressionReason",
  "duplicateOf",
  "propertyAvailability",
  "sendTime",
  "assignedTo",
  "generatedReply",
  "alternativesSuggested",
  "classificationGraded",
  "gradingNote",
  "incomingSubject",
  "incomingEmail",
];

const LONDON = "Europe/London";
function fmtLondon(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: LONDON,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value])
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

// HTML draft/email -> readable plain text for the spreadsheet.
function toText(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&pound;/gi, "£")
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mailbox = url.searchParams.get("mailbox");
  const intent = url.searchParams.get("intent");
  const parseStatus = url.searchParams.get("parseStatus");
  const eligible = url.searchParams.get("eligible");

  const rows = (await getEnquiryRows()).filter((e) => {
    if (mailbox && e.mailbox !== mailbox) return false;
    if (intent && e.intent !== intent) return false;
    if (parseStatus && e.parseStatus !== parseStatus) return false;
    if (eligible === "yes" && !e.decision?.eligible) return false;
    if (eligible === "no" && e.decision?.eligible) return false;
    return true;
  });

  const flat = rows.map((e) => {
    const d = e.decision;
    const meta = d?.generationMetadata ?? null;

    // The reason column: why eligible, or why not.
    const eligibilityReason = d?.eligible
      ? `Eligible: ${e.intent}, confidence ${e.confidence?.toFixed(2)}, applicant email and property present`
      : d?.ineligibleReason ?? "";

    const graded =
      e.gradedClassificationCorrect === true
        ? "correct"
        : e.gradedClassificationCorrect === false
        ? "incorrect"
        : "";

    return {
      enquiryId: e.id,
      received: fmtLondon(e.receivedAt),
      mailbox: e.mailbox,
      source: e.source,
      applicantName: e.applicantName ?? "",
      applicantEmail: e.applicantEmail ?? "",
      applicantPhone: e.applicantPhone ?? "",
      property: e.propertyAddress ?? e.propertyReference ?? "",
      propertyReference: e.propertyReference ?? "",
      applicantMessage: e.messageBody ?? "",
      budget: e.budgetRaw ?? "",
      requirements: e.requirements ?? "",
      interestedIn: e.interestedIn ?? "",
      aboutApplicant: e.aboutApplicant ?? "",
      intent: e.intent ?? "",
      confidence: e.confidence ?? "",
      factualQuestion: e.factualQuestion ?? "",
      parseStatus: e.parseStatus,
      parseNotes: e.parseNotes.join(" | "),
      eligible: d ? (d.eligible ? "yes" : "no") : "",
      eligibilityReason,
      suppressed: d ? (d.suppressed ? "yes" : "no") : "",
      suppressionReason: d?.suppressionReason ?? "",
      duplicateOf: d?.duplicateOf ?? "",
      propertyAvailability: meta?.availability ?? "",
      sendTime: fmtLondon(d?.wouldSendAtHeld),
      assignedTo: e.assignedTo ?? defaultAssignee(e.mailbox),
      generatedReply: toText(d?.generatedBody),
      alternativesSuggested: (meta?.alternatives ?? []).map((a) => a.url).join(" | "),
      classificationGraded: graded,
      gradingNote: e.gradingNote ?? "",
      incomingSubject: e.rawSubject,
      incomingEmail: toText(e.rawBodyText || e.rawBodyHtml),
    };
  });

  const csv = "﻿" + toCsv(flat, COLUMNS); // BOM so Excel reads UTF-8 (£) correctly
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="draper-shadow-export.csv"`,
    },
  });
}
