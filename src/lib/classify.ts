import type { Intent } from "@prisma/client";
import { complete } from "./anthropic";
import type { ParsedEnquiry } from "./parse";
import generationConfig from "../../config/generation.json";

export interface Classification {
  intent: Intent;
  confidence: number;
  factualQuestion: string | null; // the question they asked, for the follow-up call
  proposedTime: string | null; // a day/time they proposed for a viewing (Rule 4.6), or null
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

export async function classify(
  parsed: ParsedEnquiry,
  subject: string
): Promise<Classification> {
  const fallback = heuristic(parsed, subject);

  const userText = [
    `Mailbox source: ${parsed.source}`,
    `Subject: ${subject}`,
    `Property: ${parsed.propertyAddress ?? parsed.propertyReference ?? "unknown"}`,
    `Applicant message: ${parsed.messageBody ?? "(none provided)"}`,
  ].join("\n");

  try {
    const out = await complete({
      system: generationConfig.classifierSystemPrompt,
      user: userText,
      maxTokens: 200,
      temperature: 0,
    });
    if (!out) return fallback;

    const jsonMatch = out.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallback;
    const parsedOut = JSON.parse(jsonMatch[0]) as {
      intent?: string;
      confidence?: number;
      reasoning?: string;
      factualQuestion?: string | null;
      proposedTime?: string | null;
    };

    const intent = VALID_INTENTS.includes(parsedOut.intent as Intent)
      ? (parsedOut.intent as Intent)
      : fallback.intent;
    let confidence =
      typeof parsedOut.confidence === "number" ? parsedOut.confidence : fallback.confidence;
    confidence = Math.max(0, Math.min(1, confidence));

    const clean = (v: unknown): string | null =>
      typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "null"
        ? v.trim()
        : null;
    const fq = clean(parsedOut.factualQuestion);
    const proposedTime = clean(parsedOut.proposedTime);

    return { intent, confidence, factualQuestion: fq, proposedTime, raw: parsedOut };
  } catch {
    return fallback;
  }
}
