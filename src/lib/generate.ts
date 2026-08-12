import { complete, anthropicModel, anthropic } from "./anthropic";
import type { ParsedEnquiry } from "./parse";
import type { Channel, Mailbox, Property } from "@prisma/client";
import { resolvePropertyForEnquiry, typeWord, shortStreet } from "./propertyLink";
import { alternativesForEnquiry, type ScoredProperty } from "./match";
import generationConfig from "../../config/generation.json";

export interface GeneratedReply {
  body: string;
  metadata: {
    model: string;
    systemPrompt: string;
    userPrompt: string;
    phrasingIndex: number;
    generatedByLLM: boolean;
    resolvedPropertyId: string | null;
    availability: string;
    alternatives: { id: string; url: string }[];
  };
}

const signatures: Record<string, string> = generationConfig.signatures;

function pickPhrasingIndex(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % generationConfig.approvedPhrasings.length;
}

function signatureFor(mailbox: Mailbox): string {
  const raw = signatures[mailbox] ?? signatures.sales;
  return raw.replace(/\n/g, "<br>");
}

function stripCodeFences(s: string): string {
  return s.replace(/^\s*```(?:html)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
}

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
  return words.length <= generationConfig.wordLimit + 20;
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

// Short, natural way to refer to the property. Never the full address or postcode.
function propertyShortForm(property: Property | null, parsed: ParsedEnquiry): string {
  const tw = typeWord(property?.propertyType) ?? null;
  const street = property?.addressStreet ?? shortStreet(parsed.propertyAddress);
  if (tw && street) return `the ${tw} on ${street}`;
  if (tw) return `the ${tw}`;
  if (street) return `the property on ${street}`;
  return "the property";
}

function availabilityLabel(property: Property | null): string {
  if (!property) return "available (status unknown, assume available)";
  switch (property.status) {
    case "sold":
      return "NO LONGER AVAILABLE (now sold)";
    case "let":
      return "NO LONGER AVAILABLE (now let)";
    case "withdrawn":
      return "NO LONGER AVAILABLE (withdrawn)";
    case "under_offer":
      return "available (currently under offer, viewings may still be possible)";
    default:
      return "available";
  }
}

function channelFor(property: Property | null, mailbox: Mailbox): Channel {
  if (property) return property.channel;
  return mailbox === "lettings" ? "lettings" : "sales";
}

function altLine(a: ScoredProperty): string {
  const p = a.property;
  const tw = typeWord(p.propertyType) ?? "property";
  const where = shortStreet(p.addressStreet) ?? p.addressArea ?? "";
  const price = p.priceFormatted ?? (p.priceActual ? `£${p.priceActual.toLocaleString()}` : "");
  const beds = p.bedrooms ? `${p.bedrooms} bed ` : "";
  return `- ${beds}${tw} on ${where}, ${price}: ${p.url}`;
}

function fallbackBody(
  firstName: string | null,
  propertyShort: string,
  available: boolean,
  alts: ScoredProperty[]
): string {
  const greeting = firstName ? `Dear ${firstName},` : "Hello,";
  const parts = [`<p>${greeting}</p>`, `<p>Thank you for your enquiry.</p>`];
  if (available) {
    parts.push(`<p>We would be glad to arrange a viewing of ${propertyShort}. Please let us know when might be convenient for you.</p>`);
  } else {
    parts.push(`<p>I am sorry to say ${propertyShort} is no longer available. If you let me know what you are looking for, I would be happy to suggest some options.</p>`);
  }
  if (alts[0]) {
    const p = alts[0].property;
    const tw = typeWord(p.propertyType) ?? "property";
    const where = shortStreet(p.addressStreet) ?? p.addressArea ?? "the area";
    parts.push(`<p>We also have a ${tw} on ${where} which may suit: ${p.url}</p>`);
  }
  parts.push(`<p>It would help to know your general requirements so we can see what else we might have, both on and off market.</p>`);
  parts.push(`<p>Many thanks,<br>{{SIGNATURE}}</p>`);
  return parts.join("\n");
}

export async function generateReply(params: {
  parsed: ParsedEnquiry;
  mailbox: Mailbox;
}): Promise<GeneratedReply> {
  const { parsed, mailbox } = params;
  const firstName = parsed.applicantName ? parsed.applicantName.split(/\s+/)[0] : null;

  // Resolve the property from our own DB for a clean descriptor + availability.
  const property = await resolvePropertyForEnquiry(parsed);
  const propertyShort = propertyShortForm(property, parsed);
  const availability = availabilityLabel(property);
  const available = !availability.startsWith("NO LONGER");
  const channel = channelFor(property, mailbox);

  // Pick 1-2 genuinely-relevant alternatives (quality-gated).
  const alts = await alternativesForEnquiry({
    channel,
    property,
    budgetMax: parsed.budgetMax,
    bedroomsHint: bedroomsHintFrom(parsed.requirements),
    outcodeHint: property?.outcode ?? outcodeOf(parsed.propertyAddress),
    limit: 2,
  });

  const phrasingIndex = pickPhrasingIndex(parsed.applicantEmail ?? propertyShort);
  const phrasing = generationConfig.approvedPhrasings[phrasingIndex];

  const systemPrompt = generationConfig.systemPrompt;
  const userPrompt = generationConfig.userPromptTemplate
    .replace("{{firstName}}", firstName ?? "(not provided, greet without a name)")
    .replace("{{channel}}", channel)
    .replace("{{propertyShort}}", propertyShort)
    .replace("{{availability}}", availability)
    .replace("{{message}}", parsed.messageBody ?? "(none)")
    .replace("{{budget}}", parsed.budgetRaw ?? "(none)")
    .replace("{{requirements}}", parsed.requirements ?? "(none)")
    .replace("{{about}}", parsed.aboutApplicant ?? "(none)")
    .replace("{{alternatives}}", alts.length ? alts.map(altLine).join("\n") : "(none)")
    .replace("{{phrasing}}", phrasing);

  let body: string | null = null;
  let generatedByLLM = false;

  if (anthropic()) {
    try {
      const out = await complete({ system: systemPrompt, user: userPrompt, maxTokens: 500 });
      const cleaned = out ? stripCodeFences(out) : null;
      if (cleaned && cleaned.includes("{{SIGNATURE}}") && withinWordLimit(cleaned)) {
        body = cleaned;
        generatedByLLM = true;
      }
    } catch {
      /* fall through */
    }
  }

  if (!body) body = fallbackBody(firstName, propertyShort, available, alts);

  const resolvedBody = removeLongDashes(body.replace(/\{\{SIGNATURE\}\}/g, signatureFor(mailbox)));

  return {
    body: resolvedBody,
    metadata: {
      model: anthropicModel(),
      systemPrompt,
      userPrompt,
      phrasingIndex,
      generatedByLLM,
      resolvedPropertyId: property?.id ?? null,
      availability,
      alternatives: alts.map((a) => ({ id: a.property.id, url: a.property.url })),
    },
  };
}
