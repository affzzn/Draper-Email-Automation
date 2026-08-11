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

  // ── Dedupe: same applicant email within 30 minutes (spec §8) ────────────────
  if (parsed.applicantEmail) {
    const windowStart = new Date(receivedAt.getTime() - 30 * 60 * 1000);
    const windowEnd = new Date(receivedAt.getTime() + 30 * 60 * 1000);
    const sibling = await prisma.enquiry.findFirst({
      where: {
        applicantEmail: parsed.applicantEmail,
        id: { not: currentEnquiryId },
        receivedAt: { gte: windowStart, lte: windowEnd },
      },
      orderBy: { receivedAt: "asc" },
      select: { id: true },
    });
    if (sibling) base.duplicateOf = sibling.id;
  }

  return base;
}
