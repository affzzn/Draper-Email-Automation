// Prompt Playground — the read-only engine behind the /playground dev tool.
//
// SAFETY (the whole point): this module runs an enquiry through the pipeline's stages to
// preview a draft under an edited system prompt, and it is STRUCTURALLY incapable of
// sending. It imports parse / propertyLink / routing / generate — all pure, read-only
// stage functions — and NEVER imports the transport, the assignment sink, the sender
// worker, decide(), or pipeline.processMessage. It never writes an Enquiry or a Decision
// and never sets a send time. The only rows it writes are Playground* records.
//
// Isolation of the single variable: classification is REUSED from the stored enquiry (not
// re-run) so it is constant across prompt versions; the deterministic stages (match,
// alternatives, routing) run exactly as production does; only the generation system
// prompt changes between runs.

import type { Enquiry, Decision, Property } from "@prisma/client";
import type { Intent } from "@prisma/client";
import { prisma } from "./prisma";
import type { ParsedEnquiry } from "./parse";
import { extractListingPrice } from "./parse";
import type { Classification } from "./classify";
import { matchPropertyForEnquiry, typeWord } from "./propertyLink";
import { routeEnquiry, availabilityMap } from "./routing";
import { generateReply } from "./generate";
import generationConfig from "../../config/generation.json";

// The current production system prompt — the editor's starting point and the baseline
// for "compare against production".
export const PRODUCTION_SYSTEM_PROMPT: string = generationConfig.systemPrompt;

// Kept in lockstep with pipeline.ts. A match below this is shown but not trusted to drive
// the reply / routing (a wrong price is worse than none).
const MATCH_TRUST_THRESHOLD = 0.75;

// ── Result shapes (shared with the API + UI) ─────────────────────────────────

export interface StageExtraction {
  applicantName: string | null;
  applicantEmail: string | null;
  applicantPhone: string | null;
  source: string;
  emailResolvedFrom: string;
  listingPrice: number | null;
}

export interface StageMatch {
  matched: boolean;
  trusted: boolean; // confidence >= trust threshold (drives the reply)
  id: string | null;
  title: string | null;
  priceFormatted: string | null;
  bedrooms: number | null;
  type: string | null;
  status: string | null;
  confidence: number;
  method: string;
  url: string | null;
}

export interface StageAlt {
  id: string;
  title: string | null;
  priceFormatted: string | null;
  type: string | null;
  url: string;
}

export interface StageClassification {
  intent: string | null;
  confidence: number | null;
  factualQuestion: string | null;
  proposedTime: string | null;
  personalContext: string | null;
  askedWhatElse: boolean;
  source: "stored";
}

export interface StageRouting {
  owner: string;
  reason: string;
}

export interface ScoreCheck {
  id: string;
  label: string;
  pass: boolean;
  detail?: string;
}

export interface DraftView {
  body: string;
  shape: string;
  availability: string;
  generatedByLLM: boolean;
  wordCount: number;
}

export interface PlaygroundResult {
  enquiryId: string;
  summary: {
    applicant: string | null;
    property: string | null;
    mailbox: string;
    receivedAt: string;
    intentLabel: string;
  };
  extraction: StageExtraction;
  match: StageMatch;
  alternatives: StageAlt[];
  classification: StageClassification;
  routing: StageRouting;
  draft: DraftView;
  productionDraft: { body: string; shape: string | null; generatedByLLM: boolean } | null;
  scorecard: ScoreCheck[];
  passCount: number;
  failCount: number;
}

// ── Reconstruction from stored rows (no re-parse, no re-classify) ─────────────

const clean = (v: unknown): string | null =>
  typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "null" ? v.trim() : null;

function parsedFromEnquiry(e: Enquiry): ParsedEnquiry {
  return {
    source: e.source,
    applicantName: e.applicantName,
    applicantEmail: e.applicantEmail,
    applicantPhone: e.applicantPhone,
    propertyReference: e.propertyReference,
    propertyAddress: e.propertyAddress,
    propertyUrl: e.propertyUrl,
    messageBody: e.messageBody,
    budgetMax: e.budgetMax,
    budgetRaw: e.budgetRaw,
    // Not a stored column — re-derive from the raw text so the fuzzy-match cross-check
    // behaves exactly as it does in production.
    listingPrice: extractListingPrice(e.rawBodyText ?? ""),
    requirements: e.requirements,
    interestedIn: e.interestedIn,
    aboutApplicant: e.aboutApplicant,
    enquiryType: null, // envelope type is only used by the classifier, which we reuse stored
    replyTo: e.replyTo,
    emailResolvedFrom: e.emailResolvedFrom,
    parseStatus: e.parseStatus,
    parseNotes: e.parseNotes,
  };
}

// Rebuild the Classification the pipeline produced, from the stored fields. The
// portal-envelope override (if it fired at ingest) is already baked into these values
// (intent 0.90, the three signals nulled), so reusing them reproduces production exactly.
function classificationFromEnquiry(e: Enquiry): Classification {
  const raw = (e.classifierRaw ?? {}) as Record<string, unknown>;
  return {
    intent: (e.intent ?? "other") as Intent,
    confidence: e.confidence ?? 0,
    factualQuestion: e.factualQuestion ?? null,
    proposedTime: clean(raw.proposedTime),
    personalContext: clean(raw.personalContext),
    askedWhatElse: raw.askedWhatElse === true,
    raw,
  };
}

const INTENT_LABEL: Record<string, string> = {
  viewing_request: "Viewing request",
  valuation_request: "Valuation",
  landlord_enquiry: "Landlord",
  tenant_or_maintenance: "Tenant / maintenance",
  supplier: "Supplier",
  recruitment: "Recruitment",
  press: "Press",
  spam: "Spam",
  other: "Other",
};

// ── Rule scorecard (objective checks on the FINAL draft that would send) ──────

const STAFF_NAMES = ["Craig", "Olivia", "Aaron", "Mitchell", "Francesca", "Joseph"];

function draftText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordCountOf(html: string): number {
  return draftText(html).split(/\s+/).filter(Boolean).length;
}

// The draft legitimately contains our own <a> anchors for alternative properties. Strip
// those first so the "no links" rule only flags a link the MODEL wrote into prose.
function stripOurAnchors(html: string): string {
  return html.replace(/<a\b[^>]*>.*?<\/a>/gis, " ");
}

export function scoreDraft(html: string, signOffName: string | null): ScoreCheck[] {
  const text = draftText(html);
  const lower = text.toLowerCase();
  const noAnchors = stripOurAnchors(html);
  const wc = wordCountOf(html);

  const checks: ScoreCheck[] = [];
  const add = (id: string, label: string, pass: boolean, detail?: string) =>
    checks.push({ id, label, pass, detail });

  add("length", "≤ 90 words", wc <= 90, `${wc} words`);
  add("greeting", "Greeting present", /(^|\s)dear\s/i.test(text), text.slice(0, 24));
  add("no-happy", 'No "happy"', !/\bhappy\b/i.test(text), "Rule 13: use 'delighted'");
  add("no-dashes", "No em/en dashes", !/[—–]/.test(text), "Rule 11");
  add(
    "no-links",
    "No model-written links",
    !/https?:\/\/|\blink here\b|\bdetails here\b/i.test(draftText(noAnchors)),
    "Rule 3"
  );
  const stray = STAFF_NAMES.filter(
    (n) => n.toLowerCase() !== (signOffName ?? "").toLowerCase()
  ).filter((n) => new RegExp(`\\b${n}\\b`, "i").test(text));
  add(
    "no-staff",
    "No colleague named",
    stray.length === 0,
    stray.length ? `found: ${stray.join(", ")}` : "Rule 8 (sign-off excepted)"
  );
  const repeatPhrase = /further enquiry|coming back to us|getting back to us/i.test(text);
  add("no-repeat", "No 'further enquiry'", !repeatPhrase, "opens as a fresh enquiry");

  return checks;
}

// ── The run ──────────────────────────────────────────────────────────────────

type EnquiryWithDecision = Enquiry & { decision: Decision | null };

// Preload the availability map once and reuse across a batch of runs.
export async function loadAvailability() {
  return availabilityMap();
}

export async function runPlaygroundForEnquiry(
  enquiry: EnquiryWithDecision,
  systemPrompt: string,
  isAvailable?: (name: string) => boolean
): Promise<PlaygroundResult> {
  const avail = isAvailable ?? (await availabilityMap());
  const parsed = parsedFromEnquiry(enquiry);
  const classification = classificationFromEnquiry(enquiry);
  const channel: "sales" | "lettings" =
    enquiry.mailbox === "lettings" ? "lettings" : "sales";

  // Deterministic stages — exactly as production (read-only).
  const match = await matchPropertyForEnquiry(parsed, channel);
  const trusted = match.confidence >= MATCH_TRUST_THRESHOLD && !!match.property;
  const priceConfident = trusted && match.property?.priceActual != null;

  const route = routeEnquiry({
    channel,
    intent: classification.intent,
    price: match.property?.priceActual ?? null,
    priceConfident,
    isAvailable: avail,
  });

  const isRepeat = !!enquiry.decision?.duplicateOf;

  // Draft with the edited system prompt. This is the only place the LLM is called.
  const reply = await generateReply({
    parsed,
    mailbox: enquiry.mailbox,
    classification,
    isRepeat,
    property: trusted ? match.property : null,
    signOffName: route.owner,
    promptOverride: { systemPrompt },
  });

  // Look up the alternatives the generator picked, for a rich display.
  const altIds = reply.metadata.alternatives.map((a) => a.id);
  const altProps = altIds.length
    ? await prisma.property.findMany({ where: { id: { in: altIds } } })
    : [];
  const altById = new Map(altProps.map((p) => [p.id, p]));
  const alternatives: StageAlt[] = reply.metadata.alternatives.map((a) => {
    const p = altById.get(a.id);
    return {
      id: a.id,
      url: a.url,
      title: p?.title ?? null,
      priceFormatted:
        p?.priceFormatted ?? (p?.priceActual ? `£${p.priceActual.toLocaleString()}` : null),
      type: typeWord(p?.propertyType),
    };
  });

  const mp = match.property as Property | null;
  const stageMatch: StageMatch = {
    matched: !!mp,
    trusted,
    id: mp?.id ?? null,
    title: mp?.title ?? null,
    priceFormatted:
      mp?.priceFormatted ?? (mp?.priceActual ? `£${mp.priceActual.toLocaleString()}` : null),
    bedrooms: mp?.bedrooms ?? null,
    type: typeWord(mp?.propertyType),
    status: mp?.status ?? null,
    confidence: match.confidence,
    method: match.method,
    url: mp?.url ?? null,
  };

  const scorecard = scoreDraft(reply.body, route.owner);
  const passCount = scorecard.filter((c) => c.pass).length;
  const failCount = scorecard.length - passCount;

  const prodMeta = enquiry.decision?.generationMetadata as { shape?: string; generatedByLLM?: boolean } | null;

  return {
    enquiryId: enquiry.id,
    summary: {
      applicant: enquiry.applicantName,
      property: enquiry.propertyAddress ?? enquiry.propertyReference,
      mailbox: enquiry.mailbox,
      receivedAt: enquiry.receivedAt.toISOString(),
      intentLabel: INTENT_LABEL[enquiry.intent ?? "other"] ?? enquiry.intent ?? "—",
    },
    extraction: {
      applicantName: parsed.applicantName,
      applicantEmail: parsed.applicantEmail,
      applicantPhone: parsed.applicantPhone,
      source: parsed.source,
      emailResolvedFrom: parsed.emailResolvedFrom,
      listingPrice: parsed.listingPrice,
    },
    match: stageMatch,
    alternatives,
    classification: {
      intent: classification.intent,
      confidence: classification.confidence,
      factualQuestion: classification.factualQuestion,
      proposedTime: classification.proposedTime,
      personalContext: classification.personalContext,
      askedWhatElse: classification.askedWhatElse,
      source: "stored",
    },
    routing: { owner: route.owner, reason: route.reason },
    draft: {
      body: reply.body,
      shape: reply.metadata.shape,
      availability: reply.metadata.availability,
      generatedByLLM: reply.metadata.generatedByLLM,
      wordCount: wordCountOf(reply.body),
    },
    productionDraft: enquiry.decision?.generatedBody
      ? {
          body: enquiry.decision.generatedBody,
          shape: prodMeta?.shape ?? null,
          generatedByLLM: prodMeta?.generatedByLLM ?? false,
        }
      : null,
    scorecard,
    passCount,
    failCount,
  };
}
