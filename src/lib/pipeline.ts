import type { GraphMessage } from "./graph";
import type { Mailbox } from "@prisma/client";
import { prisma } from "./prisma";
import { parseMessage, htmlToText } from "./parse";
import { classify, isBarePortalViewing } from "./classify";
import { decide } from "./decide";
import { generateReply } from "./generate";
import { defaultTransport } from "./transport";
import { defaultAssignmentSink } from "./assignment";
import { mailboxByRole } from "./mailboxes";
import { matchPropertyForEnquiry, typeWord } from "./propertyLink";
import { routeEnquiry, availabilityMap } from "./routing";

// Below this confidence a property match is recorded (and shown) but NOT trusted to
// drive the reply or the £2m routing — a wrong price/type is worse than none (§5.1).
const MATCH_TRUST_THRESHOLD = 0.75;

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

  // Match the enquiry to our own listing (§5.1) so price/beds/type land on the record
  // for alternatives, the £2m routing, and naming the property type in the reply.
  // Scope the match to the inbox's channel so a sales enquiry can't match a lettings
  // listing (and vice versa).
  const enquiryChannel: "sales" | "lettings" =
    mailbox === "lettings" ? "lettings" : "sales";
  const match = await matchPropertyForEnquiry(parsed, enquiryChannel);
  const priceConfident =
    match.confidence >= MATCH_TRUST_THRESHOLD && match.property?.priceActual != null;

  // Portal-envelope override (§v5.5): a bare portal lead (applicant typed nothing) on one
  // of our listings is a viewing_request by construction. Set it deterministically at 0.90
  // instead of letting the LLM's low score on an empty message send it to the review pile.
  // The LLM's original result is preserved under classifierRaw.llm for divergence review.
  // Also force every applicant-signal to its empty value so portal furniture cannot push
  // the reply onto Shape B/C or bump the alternatives count. Applied BEFORE routing so a
  // corrected intent routes correctly.
  const matchedOurListing =
    match.confidence >= MATCH_TRUST_THRESHOLD && !!match.property;
  if (
    isBarePortalViewing({
      source: parsed.source,
      subject: msg.subject ?? "",
      rawText: textBody,
      messageBody: parsed.messageBody,
      applicantEmail: parsed.applicantEmail,
      matchedOurListing,
    })
  ) {
    classification.intent = "viewing_request";
    classification.confidence = 0.9;
    classification.factualQuestion = null;
    classification.proposedTime = null;
    classification.personalContext = null;
    classification.askedWhatElse = false;
    classification.raw = { portalEnvelopeOverride: true, llm: classification.raw };
  }

  // Route the enquiry to an owner (§3), configured for w/c 17 Aug. Channel comes from
  // the inbox (reliable), price from the confident match for the £2m split; an
  // unknown/low-confidence price falls back to Craig.
  const isAvailable = await availabilityMap();
  const route = routeEnquiry({
    channel: enquiryChannel,
    intent: classification.intent,
    price: match.property?.priceActual ?? null,
    priceConfident,
    isAvailable,
  });

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
      budgetMax: parsed.budgetMax,
      budgetRaw: parsed.budgetRaw,
      requirements: parsed.requirements,
      interestedIn: parsed.interestedIn,
      aboutApplicant: parsed.aboutApplicant,
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
      factualQuestion: classification.factualQuestion,
      matchedPropertyId: match.property?.id ?? null,
      matchedPrice: match.property?.priceActual ?? null,
      matchedBedrooms: match.property?.bedrooms ?? null,
      matchedType: typeWord(match.property?.propertyType) ?? null,
      matchConfidence: match.confidence,
      matchMethod: match.method,
      routedTo: route.owner,
      routedReason: route.reason,
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

  // Generate the body that WOULD be sent — eligible and unsuppressed. Mailbox scope
  // (v5 §7.3: hello@ is valuation-only) is now enforced by the eligibility allow-list
  // in decide(), so no hello@ special-case is needed here; a hello@ viewing_request is
  // already ineligible, a hello@ valuation_request is eligible. We also do NOT skip
  // merely because the same applicant emailed before: a same-person, same-PROPERTY
  // repeat is already a `repeat_enquiry` suppression (§9.6), handled by `!suppressed`;
  // a different-property repeat is a genuine new lead and must still be drafted (it
  // opens as a repeat via isRepeat below, for tone).
  let generatedBody: string | null = null;
  let generationMetadata: object | null = null;
  const shouldGenerate = decision.eligible && !decision.suppressed;

  if (shouldGenerate) {
    const reply = await generateReply({
      parsed,
      mailbox,
      classification,
      isRepeat: !!decision.duplicateOf,
      // Only let a confident match drive the reply; a weak one is shown but not trusted.
      property:
        match.confidence >= MATCH_TRUST_THRESHOLD ? match.property : null,
      // §3.8: the reply signs off as the routed owner (no manual override at draft time).
      signOffName: route.owner,
    });
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
      // Queue eligible drafts for the sender worker to consider (observability;
      // the worker re-checks eligibility + allowlist before anything is sent).
      sendStatus: generatedBody ? "pending" : undefined,
    },
  });

  return { enquiryId: enquiry.id, created: true };
}
