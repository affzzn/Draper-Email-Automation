import type { GraphMessage } from "./graph";
import { conversationSentAfter } from "./graph";
import type { ParsedEnquiry } from "./parse";
import { isNoReply } from "./parse";
import type { Classification } from "./classify";
import { computeSendWindows } from "./timing";
import { prisma } from "./prisma";
import generationConfig from "../../config/generation.json";
import type { SuppressionReason } from "@prisma/client";

export interface DecisionResult {
  eligible: boolean;
  ineligibleReason: string | null;
  suppressed: boolean;
  suppressionReason: SuppressionReason | null;
  duplicateOf: string | null;
  wouldSendAtImmediate: Date | null;
  wouldSendAtHeld: Date | null;
}

const CONFIDENCE_THRESHOLD = generationConfig.confidenceThreshold ?? 0.85;

function header(msg: GraphMessage, name: string): string | null {
  const h = msg.internetMessageHeaders?.find(
    (x) => x.name.toLowerCase() === name.toLowerCase()
  );
  return h?.value ?? null;
}

// Auto-responder / bulk guard (spec §8).
function isAutomatedBulk(msg: GraphMessage, parsed: ParsedEnquiry): boolean {
  // Header-based hard signals — genuine auto-responders, bulk mail, mailing lists.
  if (header(msg, "Auto-Submitted") && header(msg, "Auto-Submitted") !== "no") return true;
  if (header(msg, "X-Auto-Response-Suppress")) return true;
  const precedence = (header(msg, "Precedence") ?? "").toLowerCase();
  if (precedence === "bulk" || precedence === "list" || precedence === "junk") return true;
  if (header(msg, "List-Id")) return true;

  // A no-reply `From` is only an auto-responder signal when we could NOT resolve a
  // real applicant. Portal relays (Rightmove/Zoopla) legitimately send from a no-reply
  // address with the real applicant in Reply-To/body — those are leads, not auto-responders.
  const fromAddr = msg.from?.emailAddress?.address ?? "";
  const resolvedReal =
    !!parsed.applicantEmail && !isNoReply(parsed.applicantEmail);
  if (fromAddr && isNoReply(fromAddr) && !resolvedReal) return true;

  return false;
}

// Do two enquiries concern the same property? Compare the agency reference token
// first (most reliable), then fall back to a normalised postcode in the address.
function agencyRefToken(ref: string | null): string | null {
  if (!ref) return null;
  const m = ref.match(/[A-Z]{2,4}\d{5,}/i);
  return m ? m[0].toUpperCase() : ref.toUpperCase();
}
function postcodeKey(addr: string | null): string | null {
  if (!addr) return null;
  const m = addr.toUpperCase().match(/([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})/);
  return m ? `${m[1]}${m[2]}` : null;
}
function sameProperty(
  a: { propertyReference: string | null; propertyAddress: string | null },
  b: { propertyReference: string | null; propertyAddress: string | null }
): boolean {
  const ra = agencyRefToken(a.propertyReference);
  const rb = agencyRefToken(b.propertyReference);
  if (ra && rb) return ra === rb;
  const pa = postcodeKey(a.propertyAddress);
  const pb = postcodeKey(b.propertyAddress);
  if (pa && pb) return pa === pb;
  return false;
}

// Two independent eligibility gates (spec §6.5). Both must pass.
function evaluateEligibility(
  parsed: ParsedEnquiry,
  cls: Classification
): { eligible: boolean; reason: string | null } {
  const reasons: string[] = [];

  if (cls.intent !== "viewing_request") {
    reasons.push(`intent is ${cls.intent}, not viewing_request`);
  } else if (cls.confidence < CONFIDENCE_THRESHOLD) {
    reasons.push(
      `confidence ${cls.confidence.toFixed(2)} below threshold ${CONFIDENCE_THRESHOLD}`
    );
  }

  const hasRealEmail =
    !!parsed.applicantEmail && !isNoReply(parsed.applicantEmail);
  const hasProperty = !!parsed.propertyReference || !!parsed.propertyAddress;
  if (!hasRealEmail) reasons.push("no resolved real applicant email");
  if (!hasProperty) reasons.push("no property reference or address");

  return {
    eligible: reasons.length === 0,
    reason: reasons.length ? reasons.join("; ") : null,
  };
}

export async function decide(params: {
  mailboxAddress: string;
  msg: GraphMessage;
  parsed: ParsedEnquiry;
  classification: Classification;
  receivedAt: Date;
  currentEnquiryId: string;
}): Promise<DecisionResult> {
  const { mailboxAddress, msg, parsed, classification, receivedAt, currentEnquiryId } =
    params;

  const windows = computeSendWindows(receivedAt);
  const base: DecisionResult = {
    eligible: false,
    ineligibleReason: null,
    suppressed: false,
    suppressionReason: null,
    duplicateOf: null,
    wouldSendAtImmediate: windows.immediate,
    wouldSendAtHeld: windows.held,
  };

  // hello@ is ingested and classified but NEVER generates a reply (spec §2, §7.2).
  // Eligibility gates first.
  const elig = evaluateEligibility(parsed, classification);
  base.eligible = elig.eligible;
  base.ineligibleReason = elig.reason;

  // ── Suppression (recorded, not enforced) ───────────────────────────────────
  if (isAutomatedBulk(msg, parsed)) {
    base.suppressed = true;
    base.suppressionReason = "auto_responder_guard";
  }

  const threadId = msg.conversationId ?? null;

  // One reply per thread: has an automated reply already been decided for this thread?
  if (!base.suppressed && threadId) {
    const prior = await prisma.enquiry.findFirst({
      where: {
        threadId,
        id: { not: currentEnquiryId },
        decision: { eligible: true, suppressed: false },
      },
      select: { id: true },
    });
    if (prior) {
      base.suppressed = true;
      base.suppressionReason = "one_reply_per_thread";
    }
  }

  // Human got there first: any sent item from the mailbox on this thread after receipt.
  if (!base.suppressed && threadId) {
    try {
      const sent = await conversationSentAfter(mailboxAddress, threadId, receivedAt);
      if (sent.length > 0) {
        base.suppressed = true;
        base.suppressionReason = "human_replied_first";
      }
    } catch {
      // Non-fatal: if the sent-items lookup fails, leave unsuppressed and note nothing.
    }
  }

  // Ineligible intent is itself a suppression reason when not already suppressed.
  if (!base.suppressed && !base.eligible) {
    base.suppressed = true;
    base.suppressionReason = "ineligible_intent";
  }

  // ── Dedupe: same applicant email within 14 days (spec §8, widened) ──────────
  // A repeat from the same person is the strongest signal nobody has called them.
  if (parsed.applicantEmail) {
    const windowStart = new Date(receivedAt.getTime() - 14 * 24 * 60 * 60 * 1000);
    const sibling = await prisma.enquiry.findFirst({
      where: {
        applicantEmail: parsed.applicantEmail,
        id: { not: currentEnquiryId },
        receivedAt: { gte: windowStart, lte: receivedAt },
      },
      orderBy: { receivedAt: "asc" },
      select: { id: true, propertyReference: true, propertyAddress: true },
    });
    if (sibling) {
      base.duplicateOf = sibling.id;
      // Same person, same property, within the window -> send to a human, not generate.
      if (!base.suppressed && sameProperty(parsed, sibling)) {
        base.suppressed = true;
        base.suppressionReason = "repeat_enquiry";
      }
    }
  }

  return base;
}
