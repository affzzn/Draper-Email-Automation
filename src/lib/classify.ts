import type { Intent } from "@prisma/client";
import { complete, anthropic } from "./anthropic";
import type { ParsedEnquiry } from "./parse";
import generationConfig from "../../config/generation.json";

export interface Classification {
  intent: Intent;
  confidence: number;
  factualQuestion: string | null; // the question they asked, for the follow-up call
  proposedTime: string | null; // a day/time they proposed for a viewing (Rule 16), or null
  personalContext: string | null; // concrete personal logistic (relocation, move date, first-time buyer), or null
  askedWhatElse: boolean; // did they ask about other/similar/alternative properties
  raw: unknown; // stored for calibration (spec §6.5)
}

const VALID_INTENTS: Intent[] = [
  "viewing_request",
  "valuation_request",
  "landlord_enquiry",
  "tenant_or_maintenance",
  "supplier",
  "recruitment",
  "press",
  "spam",
  "other",
];

// Deterministic backstop. Portal viewing enquiries are strongly structured, so a
// keyword heuristic gives a usable (deliberately conservative) confidence when the
// LLM is unavailable — and is recorded as the raw signal either way.
function heuristic(parsed: ParsedEnquiry, subject: string): Classification {
  const hay = `${subject} ${parsed.messageBody ?? ""}`.toLowerCase();
  const structuredViewing =
    (parsed.source === "rightmove" || parsed.source === "zoopla") &&
    (!!parsed.propertyAddress || !!parsed.propertyReference);
  const base = {
    factualQuestion: null as string | null,
    proposedTime: null as string | null,
    personalContext: null as string | null,
    askedWhatElse: false,
    raw: { heuristic: true },
  };

  if (/valuation|value my|what.?s my (home|property) worth/.test(hay))
    return { intent: "valuation_request", confidence: 0.62, ...base };
  if (/repair|leak|broken|boiler|maintenance|tenancy/.test(hay))
    return { intent: "tenant_or_maintenance", confidence: 0.63, ...base };
  if (/invoice|supplier|partnership|advertis/.test(hay))
    return { intent: "supplier", confidence: 0.58, ...base };
  if (/unsubscribe|viagra|crypto|\bseo\b/.test(hay))
    return { intent: "spam", confidence: 0.72, ...base };

  if (structuredViewing)
    return { intent: "viewing_request", confidence: 0.74, ...base };

  if (/view|viewing|arrange|interested in|enquir/.test(hay))
    return { intent: "viewing_request", confidence: 0.58, ...base };

  return { intent: "other", confidence: 0.32, ...base };
}

// Pull the JSON object out of the model's reply. Greedy match spans the first "{"
// to the last "}", which tolerates leading/trailing prose or code fences. Returns
// null on no-match or invalid JSON so the caller can retry.
function extractJson(out: string | null): Record<string, unknown> | null {
  if (!out) return null;
  const m = out.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const clean = (v: unknown): string | null =>
  typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "null"
    ? v.trim()
    : null;

export async function classify(
  parsed: ParsedEnquiry,
  subject: string
): Promise<Classification> {
  const fallback = heuristic(parsed, subject);
  // No API key -> deterministic heuristic (don't burn an attempt that can't succeed).
  if (!anthropic()) return fallback;

  const userText = [
    `Mailbox source: ${parsed.source}`,
    `Subject: ${subject}`,
    `Property: ${parsed.propertyAddress ?? parsed.propertyReference ?? "unknown"}`,
    `Applicant message: ${parsed.messageBody ?? "(none provided)"}`,
  ].join("\n");

  // Try the model up to twice before dropping to the heuristic: a single malformed
  // JSON reply should not silently downgrade the classification (which caps confidence
  // low and can make a genuine lead ineligible). The 2nd attempt nudges JSON-only.
  // NOTE: the installed @anthropic-ai/sdk predates output_config/structured outputs;
  // upgrading the SDK would let us guarantee valid JSON and delete this retry.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const out = await complete({
        system: generationConfig.classifierSystemPrompt,
        user:
          attempt === 0
            ? userText
            : `${userText}\n\nReturn ONLY the strict JSON object described, and nothing else.`,
        maxTokens: 250,
        temperature: 0,
      });
      const parsedOut = extractJson(out);
      if (!parsedOut) continue; // retry, then fall through
      const intent = parsedOut.intent;
      if (!VALID_INTENTS.includes(intent as Intent)) continue; // retry on bad intent

      let confidence =
        typeof parsedOut.confidence === "number" ? parsedOut.confidence : fallback.confidence;
      confidence = Math.max(0, Math.min(1, confidence));

      return {
        intent: intent as Intent,
        confidence,
        factualQuestion: clean(parsedOut.factualQuestion),
        proposedTime: clean(parsedOut.proposedTime),
        personalContext: clean(parsedOut.personalContext),
        askedWhatElse: parsedOut.askedWhatElse === true,
        raw: parsedOut,
      };
    } catch {
      /* retry, then fall through to the heuristic */
    }
  }
  return fallback;
}
