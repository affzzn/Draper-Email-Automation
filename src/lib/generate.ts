import { complete, anthropicModel, anthropic } from "./anthropic";
import type { ParsedEnquiry } from "./parse";
import type { Channel, Mailbox, Property } from "@prisma/client";
import type { Classification } from "./classify";
import { resolvePropertyForEnquiry, typeWord, shortStreet } from "./propertyLink";
import { comparableForEnquiry, type ScoredProperty } from "./match";
import generationConfig from "../../config/generation.json";

export interface GeneratedReply {
  body: string;
  metadata: {
    model: string;
    shape: string;
    signOff: string;
    systemPrompt: string;
    userPrompt: string;
    generatedByLLM: boolean;
    resolvedPropertyId: string | null;
    availability: string;
    alternatives: { id: string; url: string }[];
    factualQuestion: string | null;
  };
}

const signatures: Record<string, string> = generationConfig.signatures;
const signOffs: string[] = generationConfig.signOffs;
const HARD = generationConfig.wordLimitHard ?? 90;
const SUPPRESS = generationConfig.alternativesPolicy.suppressAboveValue;

function signatureFor(mailbox: Mailbox): string {
  const raw = signatures[mailbox] ?? signatures.sales;
  return raw.replace(/\n/g, "<br>");
}

function hashPick<T>(arr: T[], seed: string): T {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return arr[h % arr.length];
}

function stripCodeFences(s: string): string {
  return s.replace(/^\s*```(?:html)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
}

// The model must never emit links or link-words. Defensive scrub before we insert
// our own anchor for {{ALT_1}}.
function stripModelLinks(s: string): string {
  return s
    .replace(/<a\b[^>]*>(.*?)<\/a>/gis, "$1") // unwrap any anchor, keep text
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\[?\(?\s*link(?:\s*here)?\s*:?\s*\)?\]?/gi, "")
    .replace(/\bdetails here\s*:?/gi, "")
    .replace(/ {2,}/g, " ");
}

export function removeLongDashes(s: string): string {
  return s
    .replace(/\s+[—–]\s+/g, ", ")
    .replace(/[—–]/g, "-")
    .replace(/ {2,}/g, " ")
    .replace(/ ,/g, ",")
    .replace(/,\s*,/g, ",");
}

function wordCount(html: string): number {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\{\{SIGNATURE\}\}|\{\{ALT_1\}\}/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function outcodeOf(address: string | null): string | null {
  if (!address) return null;
  const m = address.toUpperCase().match(/\b([A-Z]{1,2}\d[A-Z\d]?)\b/);
  return m ? m[1] : null;
}

function bedroomsHintFrom(requirements: string | null): number | null {
  if (!requirements) return null;
  const m = requirements.match(/(\d+)\s*\+?\s*bed/i);
  return m ? parseInt(m[1], 10) : null;
}

// Short, natural property reference computed IN CODE from our clean DB record only.
// If we have no DB match, return "" so the model falls back to "the property".
function propertyShortForm(property: Property | null): string {
  if (!property) return "";
  const tw = typeWord(property.propertyType);
  const street = property.addressStreet;
  if (tw && street) return `the ${tw} on ${street}`;
  if (tw) return `the ${tw}`;
  if (street) return `the property on ${street}`;
  return "";
}

function availabilityLabel(property: Property | null): "available" | "unknown" | "unavailable" {
  if (!property) return "unknown";
  if (["sold", "let", "withdrawn"].includes(property.status)) return "unavailable";
  return "available"; // for_sale / to_let / under_offer
}

function channelFor(property: Property | null, mailbox: Mailbox): Channel {
  if (property) return property.channel;
  return mailbox === "lettings" ? "lettings" : "sales";
}

// Shape selection happens in code (not the model). First match wins: D, B, C, A.
function selectShape(
  availability: string,
  factualQuestion: string | null,
  message: string | null
): "A" | "B" | "C" | "D" {
  if (availability === "unavailable") return "D";
  const msg = message ?? "";
  const hasFactual =
    !!factualQuestion ||
    /\b(lease|service charge|epc|available|availability|pets?|parking|chain|tenure|square (feet|footage)|sq ?ft|council tax|furnished|unfurnished|garden|deposit)\b\??/i.test(
      msg
    ) && /\?/.test(msg);
  if (hasFactual) return "B";
  const hasContext =
    /\brelocat|moving (from|over|to)|move[- ]?in|move date|first[- ]?time buyer|buying with|my (partner|husband|wife|family)|current lease|lease ends|corporate let|embassy|student|starting (work|a job)/i.test(
      msg
    );
  if (hasContext) return "C";
  return "A";
}

function askedWhatElse(message: string | null): boolean {
  return /what else|anything else|else do you have|other propert|similar propert|alternatives?/i.test(
    message ?? ""
  );
}

function suppressAltByValue(channel: Channel, property: Property | null): boolean {
  if (!property?.priceActual) return false;
  if (channel === "sales") return property.priceActual > SUPPRESS.salesAskingPrice;
  if (channel === "lettings") return property.priceActual > SUPPRESS.lettingsPcm;
  return false;
}

function altDescription(a: ScoredProperty): string {
  const p = a.property;
  const tw = typeWord(p.propertyType) ?? "property";
  const beds = p.bedrooms ? `${p.bedrooms} bedroom ` : "";
  const where = shortStreet(p.addressStreet) ?? p.addressArea ?? "the area";
  return `a similar ${beds}${tw} on ${where}`;
}

function altAnchor(a: ScoredProperty): string {
  const p = a.property;
  const where = shortStreet(p.addressStreet) ?? p.addressArea ?? "View property";
  const price = p.priceFormatted ?? (p.priceActual ? `£${p.priceActual.toLocaleString()}` : "");
  const label = price ? `${where}, ${price}` : where;
  return `<a href="${p.url}">${label}</a>`;
}

function fallbackBody(
  firstName: string | null,
  propertyShort: string,
  availability: string,
  signOff: string,
  alt: ScoredProperty | null
): string {
  const who = propertyShort || "the property";
  const greet = firstName ? `Dear ${firstName},` : "Dear Sir or Madam,";
  const parts = [`<p>${greet}</p>`];
  if (availability === "unavailable") {
    parts.push(`<p>Thank you for your enquiry. I am sorry to say ${who} has now been sold or let.</p>`);
    if (alt) {
      parts.push(`<p>We do have something else which may be of interest.</p>`, `<p>{{ALT_1}}</p>`);
    } else {
      parts.push(`<p>If you let me know what you are looking for, I would be happy to suggest some options.</p>`);
    }
  } else {
    parts.push(`<p>Thank you for your enquiry.</p>`);
    parts.push(`<p>We would be glad to arrange a viewing of ${who}. When would suit you?</p>`);
  }
  parts.push(`<p>${signOff},<br>{{SIGNATURE}}</p>`);
  return parts.join("\n");
}

export async function generateReply(params: {
  parsed: ParsedEnquiry;
  mailbox: Mailbox;
  classification: Classification;
  isRepeat?: boolean;
}): Promise<GeneratedReply> {
  const { parsed, mailbox, classification } = params;
  const firstName = parsed.applicantName ? parsed.applicantName.split(/\s+/)[0] : null;

  const property = await resolvePropertyForEnquiry(parsed);
  const propertyShort = propertyShortForm(property);
  const availability = availabilityLabel(property);
  const channel = channelFor(property, mailbox);
  const signOff = hashPick(signOffs, parsed.applicantEmail ?? propertyShort ?? "x");
  const shape = selectShape(availability, classification.factualQuestion, parsed.messageBody);

  // Alternatives (v3): decided entirely in code. Suppress on high value, on repeats,
  // and on shape B unless they explicitly asked about others. Otherwise offer one IF a
  // genuinely comparable property exists nearby (the "Anshika case"), never a weak match.
  const asked = askedWhatElse(parsed.messageBody);
  const reqBeds = bedroomsHintFrom(parsed.requirements);
  const seedOutcode = property?.outcode ?? outcodeOf(parsed.propertyAddress);
  const seedPrice = property?.priceActual ?? parsed.budgetMax ?? null;
  const seedBeds = property?.bedrooms ?? reqBeds;

  let altToUse: ScoredProperty | null = null;
  const suppressAlt =
    suppressAltByValue(channel, property) ||
    params.isRepeat === true ||
    (shape === "B" && !asked);

  if (!suppressAlt && seedOutcode && seedPrice !== null) {
    altToUse = await comparableForEnquiry({
      channel,
      seedPrice,
      seedBeds,
      requiredBeds: reqBeds,
      seedOutcode,
      budgetMax: parsed.budgetMax,
      excludePropertyId: property?.id,
      excludeRef: parsed.propertyReference,
      excludeAddress: parsed.propertyAddress,
    });
  }

  // Enquired-property context for the model (v3 requiredInputs).
  const propPrice = property?.priceFormatted ?? (property?.priceActual ? `£${property.priceActual.toLocaleString()}` : "(price not known)");
  const propBeds = property?.bedrooms != null ? String(property.bedrooms) : "";
  const propType = typeWord(property?.propertyType) ?? "property";

  const systemPrompt = generationConfig.systemPrompt;
  const userPrompt = generationConfig.userPromptTemplate
    .replace("{{shape}}", shape)
    .replace("{{signOff}}", signOff)
    .replace("{{firstName}}", firstName ?? "")
    .replace("{{channel}}", channel)
    .replace("{{propertyShort}}", propertyShort || "(none, say 'the property')")
    .replace("{{availability}}", availability)
    .replace("{{message}}", parsed.messageBody ?? "")
    .replace("{{budget}}", parsed.budgetRaw ?? "")
    .replace("{{requirements}}", parsed.requirements ?? "")
    .replace("{{about}}", parsed.aboutApplicant ?? "")
    .replace("{{propertyPrice}}", propPrice)
    .replace("{{propertyBedrooms}}", propBeds)
    .replace("{{propertyType}}", propType)
    .replace("{{alternativeDescription}}", altToUse ? altDescription(altToUse) : "")
    .replace("{{isRepeat}}", params.isRepeat ? "true" : "false");

  let body: string | null = null;
  let generatedByLLM = false;

  if (anthropic()) {
    try {
      const out = await complete({ system: systemPrompt, user: userPrompt, maxTokens: 450 });
      let cleaned = out ? stripModelLinks(stripCodeFences(out)) : null;
      if (cleaned && cleaned.includes("{{SIGNATURE}}") && wordCount(cleaned) <= HARD + 12) {
        // If the model referenced an alt but we have none, drop the stray token/line.
        if (!altToUse) cleaned = cleaned.replace(/<p>\s*\{\{ALT_1\}\}\s*<\/p>/gi, "").replace(/\{\{ALT_1\}\}/g, "");
        body = cleaned;
        generatedByLLM = true;
      }
    } catch {
      /* fall through */
    }
  }

  if (!body) body = fallbackBody(firstName, propertyShort, availability, signOff, altToUse);

  // Insert our own anchor for {{ALT_1}} (the model never writes links), then sign.
  let resolved = body;
  if (altToUse) resolved = resolved.replace(/\{\{ALT_1\}\}/g, altAnchor(altToUse));
  resolved = resolved.replace(/<p>\s*<\/p>/g, "");
  resolved = removeLongDashes(resolved.replace(/\{\{SIGNATURE\}\}/g, signatureFor(mailbox)));

  return {
    body: resolved,
    metadata: {
      model: anthropicModel(),
      shape,
      signOff,
      systemPrompt,
      userPrompt,
      generatedByLLM,
      resolvedPropertyId: property?.id ?? null,
      availability,
      alternatives: altToUse ? [{ id: altToUse.property.id, url: altToUse.property.url }] : [],
      factualQuestion: classification.factualQuestion,
    },
  };
}
