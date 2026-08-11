import type { Intent } from "@prisma/client";
import { complete } from "./anthropic";
import type { ParsedEnquiry } from "./parse";
import generationConfig from "../../config/generation.json";

export interface Classification {
  intent: Intent;
  confidence: number;
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

  if (/valuation|value my|what.?s my (home|property) worth/.test(hay))
    return { intent: "valuation_request", confidence: 0.6, raw: { heuristic: true } };
  if (/repair|leak|broken|boiler|maintenance|tenancy/.test(hay))
    return { intent: "tenant_or_maintenance", confidence: 0.6, raw: { heuristic: true } };
  if (/invoice|supplier|partnership|advertis/.test(hay))
    return { intent: "supplier", confidence: 0.55, raw: { heuristic: true } };
  if (/unsubscribe|viagra|crypto|\bseo\b/.test(hay))
    return { intent: "spam", confidence: 0.7, raw: { heuristic: true } };

  if (structuredViewing)
    return { intent: "viewing_request", confidence: 0.7, raw: { heuristic: true } };

  if (/view|viewing|arrange|interested in|enquir/.test(hay))
    return { intent: "viewing_request", confidence: 0.5, raw: { heuristic: true } };

  return { intent: "other", confidence: 0.3, raw: { heuristic: true } };
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
    };

    const intent = VALID_INTENTS.includes(parsedOut.intent as Intent)
      ? (parsedOut.intent as Intent)
      : fallback.intent;
    let confidence =
      typeof parsedOut.confidence === "number" ? parsedOut.confidence : fallback.confidence;
    confidence = Math.max(0, Math.min(1, confidence));

    return { intent, confidence, raw: parsedOut };
  } catch {
    return fallback;
  }
}
