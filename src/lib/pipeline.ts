import type { GraphMessage } from "./graph";
import type { Mailbox } from "@prisma/client";
import { prisma } from "./prisma";
import { parseMessage, htmlToText } from "./parse";
import { classify } from "./classify";
import { decide } from "./decide";
import { generateReply } from "./generate";
import { getEnricher } from "./enrich";
import { defaultTransport } from "./transport";
import { defaultAssignmentSink } from "./assignment";
import { mailboxByRole } from "./mailboxes";

// Process one Graph message end-to-end. Idempotent on graphMessageId (spec §5).
// Returns the enquiry id. Safe to call repeatedly for the same message.
export async function processMessage(
  mailbox: Mailbox,
  msg: GraphMessage
): Promise<{ enquiryId: string; created: boolean }> {
  // Skip staff drafts entirely — never treat our own or staff drafts as enquiries.
  if (msg.isDraft) {
    return { enquiryId: "", created: false };
  }

  const existing = await prisma.enquiry.findUnique({
    where: { graphMessageId: msg.id },
    select: { id: true },
  });
  if (existing) {
    return { enquiryId: existing.id, created: false };
  }

  const mailboxAddress = mailboxByRole(mailbox).address;
  const parsed = parseMessage(msg);

  const receivedAt = msg.receivedDateTime
    ? new Date(msg.receivedDateTime)
    : new Date();

  const html = msg.body?.contentType === "html" ? msg.body?.content ?? "" : "";
  const textBody =
    msg.body?.contentType === "html"
      ? htmlToText(html)
      : msg.body?.content ?? msg.bodyPreview ?? "";

  const headersJson = Object.fromEntries(
    (msg.internetMessageHeaders ?? []).map((h) => [h.name, h.value])
  );

  // Classify (LLM with deterministic fallback).
  const classification = await classify(parsed, msg.subject ?? "");

  // Persist the enquiry first so decide() can run dedupe / thread lookups against it.
  const enquiry = await prisma.enquiry.create({
    data: {
      graphMessageId: msg.id,
      mailbox,
      receivedAt,
      source: parsed.source,
      applicantName: parsed.applicantName,
      applicantEmail: parsed.applicantEmail,
      applicantPhone: parsed.applicantPhone,
      propertyReference: parsed.propertyReference,
      propertyAddress: parsed.propertyAddress,
      propertyUrl: parsed.propertyUrl,
      messageBody: parsed.messageBody,
      rawSubject: msg.subject ?? "",
      rawHeaders: headersJson,
      rawBodyHtml: html,
      rawBodyText: textBody,
      replyTo: parsed.replyTo,
      threadId: msg.conversationId ?? null,
      parseStatus: parsed.parseStatus,
      parseNotes: parsed.parseNotes,
      emailResolvedFrom: parsed.emailResolvedFrom,
      intent: classification.intent,
      confidence: classification.confidence,
      classifierRaw: classification.raw as object,
    },
  });

  // Decide (all rules recorded, none enforced).
  const decision = await decide({
    mailboxAddress,
    msg,
    parsed,
    classification,
    receivedAt,
    currentEnquiryId: enquiry.id,
  });

  // Generate the body that WOULD be sent — eligible, unsuppressed, non-duplicate,
  // and never for hello@ (spec §2/§7.2).
  let generatedBody: string | null = null;
  let generationMetadata: object | null = null;
  const shouldGenerate =
    decision.eligible &&
    !decision.suppressed &&
    !decision.duplicateOf &&
    mailbox !== "hello";

  if (shouldGenerate) {
    const enrichment = await getEnricher().enrich(parsed);
    const reply = await generateReply({ parsed, enrichment, mailbox });
    generatedBody = reply.body;
    generationMetadata = reply.metadata;
  }

  // Deferred interfaces — no-op transport + logging assignment sink (spec §9).
  const sendAt = decision.wouldSendAtImmediate;
  const transportResult = generatedBody
    ? await defaultTransport.send({
        enquiryId: enquiry.id,
        toEmail: parsed.applicantEmail,
        subject: `Re: ${parsed.propertyAddress ?? parsed.propertyReference ?? "your enquiry"}`,
        body: generatedBody,
        sendAt,
      })
    : null;

  const assignmentResult = await defaultAssignmentSink.submit({
    enquiryId: enquiry.id,
    mailbox,
    intent: classification.intent,
    suggestion: { suggestedOwner: null, reason: null },
  });

  await prisma.decision.create({
    data: {
      enquiryId: enquiry.id,
      eligible: decision.eligible,
      ineligibleReason: decision.ineligibleReason,
      suppressed: decision.suppressed,
      suppressionReason: decision.suppressionReason,
      duplicateOf: decision.duplicateOf,
      wouldSendAtImmediate: decision.wouldSendAtImmediate,
      wouldSendAtHeld: decision.wouldSendAtHeld,
      generatedBody,
      generationMetadata: generationMetadata ?? undefined,
      transportRecord: transportResult ? (transportResult as unknown as object) : undefined,
      assignmentRecord: assignmentResult as unknown as object,
    },
  });

  return { enquiryId: enquiry.id, created: true };
}
