import { complete, anthropicModel, anthropic } from "./anthropic";
import type { ParsedEnquiry } from "./parse";
import type { Enrichment } from "./enrich";
import type { Mailbox } from "@prisma/client";
import generationConfig from "../../config/generation.json";

export interface GeneratedReply {
  body: string;
  metadata: {
    model: string;
    systemPrompt: string;
    userPrompt: string;
    phrasingIndex: number;
    temperature: number;
    generatedByLLM: boolean;
  };
}

const signatures: Record<string, string> = generationConfig.signatures;

// Controlled variation (spec §7.2): pick an approved phrasing deterministically from
// the applicant email so someone enquiring on 3 properties doesn't get 3 identical mails.
function pickPhrasingIndex(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % generationConfig.approvedPhrasings.length;
}

function signatureFor(mailbox: Mailbox): string {
  const raw = signatures[mailbox] ?? signatures.sales;
  return raw.replace(/\n/g, "<br>");
}

function enrichmentBlurb(e: Enrichment | null): string {
  if (!e) return "";
  const bits: string[] = [];
  if (e.property_price) bits.push(`asking price ${e.property_price}`);
  if (e.property_bedrooms) bits.push(`${e.property_bedrooms} bedrooms`);
  if (e.property_features?.length) bits.push(e.property_features.slice(0, 2).join(", "));
  return bits.join("; ");
}

// Deterministic fallback body if the LLM is unavailable — still obeys all copy rules
// and degrades gracefully with no enrichment (spec §7.1).
function fallbackBody(firstName: string | null, property: string): string {
  const greeting = firstName ? `Dear ${firstName},` : "Hello,";
  return [
    `<p>${greeting}</p>`,
    `<p>Thank you for your enquiry about ${property}. We'd be glad to arrange a viewing for you.</p>`,
    `<p>Could you let us know a couple of times that might suit, and we'll get it in the diary? If there's anything particular you're looking for, do tell us and we'll keep an eye out.</p>`,
    `<p>{{SIGNATURE}}</p>`,
  ].join("\n");
}

// Models sometimes wrap HTML in a ```html … ``` markdown fence. Strip it.
function stripCodeFences(s: string): string {
  return s
    .replace(/^\s*```(?:html)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

// No em dashes or en dashes anywhere in outgoing copy. Convert a spaced dash to a
// comma; a tight dash (e.g. a range) to a hyphen. Then tidy spacing.
export function removeLongDashes(s: string): string {
  return s
    .replace(/\s+[—–]\s+/g, ", ")
    .replace(/[—–]/g, "-")
    .replace(/ {2,}/g, " ")
    .replace(/ ,/g, ",")
    .replace(/,\s*,/g, ",");
}

function withinWordLimit(html: string): boolean {
  const words = html.replace(/<[^>]+>/g, " ").replace(/\{\{SIGNATURE\}\}/g, "").trim().split(/\s+/).filter(Boolean);
  return words.length <= generationConfig.wordLimit + 10; // small tolerance
}

export async function generateReply(params: {
  parsed: ParsedEnquiry;
  enrichment: Enrichment | null;
  mailbox: Mailbox;
}): Promise<GeneratedReply> {
  const { parsed, enrichment, mailbox } = params;
  const firstName = parsed.applicantName ? parsed.applicantName.split(/\s+/)[0] : null;
  const property = parsed.propertyAddress ?? parsed.propertyReference ?? "the property";
  const seed = parsed.applicantEmail ?? property;
  const phrasingIndex = pickPhrasingIndex(seed);
  const phrasing = generationConfig.approvedPhrasings[phrasingIndex];

  const systemPrompt = generationConfig.systemPrompt;
  const userPrompt = generationConfig.userPromptTemplate
    .replace("{{firstName}}", firstName ?? "(not provided, greet without a name)")
    .replace("{{property}}", property)
    .replace("{{enrichment}}", enrichmentBlurb(enrichment) || "(none)")
    .replace("{{phrasing}}", phrasing);

  const temperature = 0.6;
  let body: string | null = null;
  let generatedByLLM = false;

  if (anthropic()) {
    try {
      const out = await complete({
        system: systemPrompt,
        user: userPrompt,
        maxTokens: 400,
        temperature,
      });
      const cleaned = out ? stripCodeFences(out) : null;
      if (cleaned && cleaned.includes("{{SIGNATURE}}") && withinWordLimit(cleaned)) {
        body = cleaned;
        generatedByLLM = true;
      }
    } catch {
      /* fall through to deterministic body */
    }
  }

  if (!body) body = fallbackBody(firstName, property);

  // Fill signature placeholder from per-mailbox config, then strip any long dashes.
  const resolvedBody = removeLongDashes(
    body.replace(/\{\{SIGNATURE\}\}/g, signatureFor(mailbox))
  );

  return {
    body: resolvedBody,
    metadata: {
      model: anthropicModel(),
      systemPrompt,
      userPrompt,
      phrasingIndex,
      temperature,
      generatedByLLM,
    },
  };
}
