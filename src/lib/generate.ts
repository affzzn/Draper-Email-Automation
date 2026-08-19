import { complete, anthropicModel, anthropic } from "./anthropic";
import type { ParsedEnquiry } from "./parse";
import type { Channel, Mailbox, Property } from "@prisma/client";
import type { Classification } from "./classify";
import { resolvePropertyForEnquiry, typeWord, shortStreet } from "./propertyLink";
import { comparablesForEnquiry, type ScoredProperty } from "./match";
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

const signatures: Record<string, string> = generationConfig.signatures as Record<string, string>;
const signOffs: string[] = generationConfig.signOffs;
const MAX_ALTS: number = generationConfig.alternativesPolicy?.maxPerReply ?? 3;
const HARD = generationConfig.wordLimitHard ?? 90;

// v5: the reply always sends from the inbox address, but the NAME at the bottom
// follows whoever the enquiry was routed to (Craig, 14 Aug call). {{SIGNATURE}}
// therefore expands to that name plus the inbox's own signature block.
// We add NO signature of our own — no name, no block. The negotiator is cc'd (§2.4),
// and the mailbox appends its own branded Draper signature on send. {{SIGNATURE}}
// expands to the inbox block only, which is currently empty (so: nothing).
function signatureFor(mailbox: Mailbox): string {
  const raw = (signatures[mailbox] ?? signatures.sales ?? "").trim();
  return raw ? raw.replace(/\n/g, "<br>") : "";
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
    .replace(/\{\{SIGNATURE\}\}|\{\{ALT_[123]\}\}/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

// Fill a template token WITHOUT String.replace's "$&"/"$'" replacement patterns —
// applicant text containing "$" must never garble the prompt. split/join is literal.
function fill(template: string, token: string, value: string): string {
  return template.split(token).join(value);
}

// Applicant-controlled text goes into the prompt as data. Strip anything that looks
// like our own template tokens so it can't spoof {{ALT_1}}/{{SIGNATURE}} handling.
function safeText(s: string | null | undefined): string {
  return (s ?? "").replace(/\{\{|\}\}/g, " ");
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
  // under_offer = SSTC / under offer / let agreed. Still offer a viewing (Craig's
  // "always say yes"), but never claim it is available — so treat it as "unknown".
  if (property.status === "under_offer") return "unknown";
  return "available"; // for_sale / to_let only
}

function channelFor(property: Property | null, mailbox: Mailbox): Channel {
  if (property) return property.channel;
  return mailbox === "lettings" ? "lettings" : "sales";
}

// Shape selection happens in code (not the model). First match wins: E, D, B, C, A.
// v5 adds E, the valuation reply. It is first because a valuation request has no
// property of ours behind it, so availability and factual-question tests are moot.
function selectShape(
  intent: string,
  availability: string,
  factualQuestion: string | null,
  proposedTime: string | null,
  personalContext: string | null,
  message: string | null
): "A" | "B" | "C" | "D" | "E" {
  if (intent === "valuation_request") return "E";
  if (availability === "unavailable") return "D";
  const msg = message ?? "";
  const hasFactual =
    !!factualQuestion ||
    // Genuine look-up facts only. Availability is NOT here (a "is it available?"
    // question is answered by the availability field / handled as a normal viewing,
    // never as "I will find out"), nor are viewing times (Rule 16 handles those).
    /\b(lease|service charge|ground rent|epc|pets?|parking|chain|tenure|square (feet|footage)|sq ?ft|council tax|furnished|unfurnished|garden|deposit)\b\??/i.test(
      msg
    ) && /\?/.test(msg);
  if (hasFactual) return "B";
  // Actionable context only. A couple/family mention ("my wife and I") is NOT context
  // to respond to — it invites gushing (Rule 19) and belongs in a bare Shape A reply.
  // Primary signal is the classifier's `personalContext` (catches paraphrases a regex
  // misses); the keyword regex stays as an additive backstop so we never lose coverage.
  const hasContext =
    !!personalContext ||
    /\brelocat|moving (from|over|to)|move[- ]?in|move date|first[- ]?time buyer|current lease|lease ends|corporate let|embassy|student|starting (work|a job)/i.test(
      msg
    );
  // A proposed viewing day/time (extracted by the classifier, so any phrasing is caught)
  // is concrete detail to acknowledge (Rule 16) — route to Shape C so the reply names it.
  if (hasContext || proposedTime) return "C";
  return "A";
}

// True if they asked about other/similar/alternative properties. Classifier signal is
// primary (catches phrasings the regex misses); the regex remains an additive backstop.
function askedWhatElse(classifierAsked: boolean, message: string | null): boolean {
  return (
    classifierAsked ||
    /what else|anything else|else do you have|other propert|similar propert|alternatives?/i.test(
      message ?? ""
    )
  );
}

function altDescription(a: ScoredProperty): string {
  const p = a.property;
  const tw = typeWord(p.propertyType) ?? "property";
  const beds = p.bedrooms ? `${p.bedrooms} bedroom ` : "";
  const where = shortStreet(p.addressStreet) ?? p.addressArea ?? "the area";
  return `a similar ${beds}${tw} on ${where}`;
}

// v5: Craig asked for "a selection of two or three others", so the model is given a
// numbered list and one token per property rather than a single description.
function altDescriptions(list: ScoredProperty[]): string {
  if (!list.length) return "";
  return list.map((a, i) => `${i + 1}. ${altDescription(a)}`).join("\n");
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
  alts: ScoredProperty[],
  shape: string
): string {
  const who = propertyShort || "the property";
  const greet = firstName ? `Dear ${firstName},` : "Dear Sir or Madam,";
  const parts = [`<p>${greet}</p>`];
  if (shape === "E") {
    // Valuation request. Craig's own wording, 14 Aug. No figure, no viewing, no properties.
    parts.push(`<p>Thank you for your valuation request.</p>`);
    parts.push(`<p>We would be delighted to meet with you. Please let us know when you are free.</p>`);
  } else if (availability === "unavailable") {
    parts.push(`<p>Thank you for your enquiry. I am sorry to say ${who} has now been sold or let.</p>`);
    if (alts.length) {
      parts.push(`<p>We do have something else which may be of interest.</p>`);
      alts.forEach((_, i) => parts.push(`<p>{{ALT_${i + 1}}}</p>`));
    } else {
      parts.push(`<p>If you let me know what you are looking for, I would be delighted to suggest some options.</p>`);
    }
  } else {
    parts.push(`<p>Thank you for your enquiry.</p>`);
    parts.push(`<p>We would be delighted to arrange a viewing of ${who}. Please let us know when might suit you to view.</p>`);
    if (alts.length) {
      parts.push(`<p>We also have something similar in the area, in case it is of interest.</p>`);
      alts.forEach((_, i) => parts.push(`<p>{{ALT_${i + 1}}}</p>`));
    }
  }
  parts.push(`<p>${signOff},<br>{{SIGNATURE}}</p>`);
  return parts.join("\n");
}

export async function generateReply(params: {
  parsed: ParsedEnquiry;
  mailbox: Mailbox;
  classification: Classification;
  isRepeat?: boolean;
  /** v5: first name of the person this enquiry was routed to. Signs the reply. */
  signOffName?: string | null;
  /** §5.1: the matched listing, resolved once in the pipeline. Pass null to force
   *  "no match"; omit entirely and the generator resolves it itself (direct callers). */
  property?: Property | null;
}): Promise<GeneratedReply> {
  const { parsed, mailbox, classification } = params;
  // First name for the greeting. Strip stray edge punctuation so "Ji- Chiu" greets as
  // "Dear Ji," not "Dear Ji-," (keeps internal hyphen/apostrophe: Anne-Marie, O'Brien).
  const rawFirst = parsed.applicantName ? parsed.applicantName.split(/\s+/)[0] : null;
  const cleanedFirst = rawFirst ? rawFirst.replace(/^[-'’.]+|[-'’.]+$/g, "").trim() : "";
  const firstName = cleanedFirst || null;

  const property =
    params.property !== undefined
      ? params.property
      : await resolvePropertyForEnquiry(
          parsed,
          mailbox === "lettings" ? "lettings" : "sales"
        );
  const propertyShort = propertyShortForm(property);
  const availability = availabilityLabel(property);
  const channel = channelFor(property, mailbox);
  const signOff = hashPick(signOffs, parsed.applicantEmail ?? propertyShort ?? "x");
  const shape = selectShape(
    classification.intent,
    availability,
    classification.factualQuestion,
    classification.proposedTime,
    classification.personalContext,
    parsed.messageBody
  );

  // Alternatives: decided entirely in code.
  // v4 (14 Aug call): the >£2m / >£7,500 value suppression was removed, since the 10%
  // band already yields nothing to cross-sell at the top of the market.
  // v5: the shape B suppression is gone too. Craig was asked whether he wanted
  // alternatives on all enquiries or just some and said "For all inquiries". Up to
  // three are now passed through (two is the normal case). Valuations get none.
  const asked = askedWhatElse(classification.askedWhatElse, parsed.messageBody);
  const reqBeds = bedroomsHintFrom(parsed.requirements);
  const seedOutcode = property?.outcode ?? outcodeOf(parsed.propertyAddress);
  const seedPrice = property?.priceActual ?? parsed.budgetMax ?? null;
  const seedBeds = property?.bedrooms ?? reqBeds;

  let altsToUse: ScoredProperty[] = [];
  const suppressAlt = params.isRepeat === true || shape === "E";

  if (!suppressAlt && seedOutcode && seedPrice !== null) {
    altsToUse = await comparablesForEnquiry({
      channel,
      seedPrice,
      seedBeds,
      requiredBeds: reqBeds,
      seedOutcode,
      budgetMax: parsed.budgetMax,
      excludePropertyId: property?.id,
      excludeRef: parsed.propertyReference,
      excludeAddress: parsed.propertyAddress,
      // Two is the normal case; give three only when they explicitly asked what else
      // is available (alternativesPolicy.alwaysOfferWhen).
      limit: asked ? MAX_ALTS : Math.min(2, MAX_ALTS),
    });
  }

  // Enquired-property context for the model (v3 requiredInputs), as one clean line —
  // no malformed ", bedroom property" fragment when nothing matched.
  const propertyFacts = property
    ? [
        property.priceFormatted ??
          (property.priceActual ? `£${property.priceActual.toLocaleString()}` : null),
        property.bedrooms != null ? `${property.bedrooms} bedroom` : null,
        typeWord(property.propertyType),
      ]
        .filter(Boolean)
        .join(", ")
    : "(not matched to one of our listings; rely only on the fields above and invent nothing)";

  // Strong per-enquiry directive to name the proposed day/time back (the classifier
  // extracts it, so any phrasing is caught). Empty when none was proposed.
  const proposedTimeNote = classification.proposedTime
    ? `The applicant proposed this for the viewing: "${safeText(classification.proposedTime)}". Refer to what they proposed so they can see it was read, but you have no diary access and must NOT say or imply it works, is fine, is available or suits us. Tell them you will confirm availability and come back to them on the timing (you may also ask what exact time within their window would suit, only as noting their preference). Never confirm or book a slot, and never fall back to a generic "when would suit" that ignores the time they gave. Put this after the viewing offer, not before it.`
    : "";
  // Never engage with a "property to sell" / valuation signal on a viewing enquiry
  // (Craig: do not offer a valuation to an applicant). Drop it from the context.
  const aboutForModel = /\bto sell\b|sell my|property to sell|valuation|value my/i.test(
    parsed.aboutApplicant ?? ""
  )
    ? ""
    : parsed.aboutApplicant ?? "";

  const systemPrompt = generationConfig.systemPrompt;
  let userPrompt = generationConfig.userPromptTemplate;
  const fills: [string, string][] = [
    ["{{shape}}", shape],
    ["{{intent}}", classification.intent],
    ["{{signOff}}", signOff],
    ["{{firstName}}", firstName ?? ""],
    ["{{channel}}", channel],
    ["{{propertyShort}}", propertyShort || "(none, say 'the property')"],
    ["{{availability}}", availability],
    ["{{message}}", safeText(parsed.messageBody)],
    ["{{budget}}", safeText(parsed.budgetRaw)],
    ["{{requirements}}", safeText(parsed.requirements)],
    ["{{about}}", safeText(aboutForModel)],
    ["{{proposedTimeNote}}", proposedTimeNote],
    ["{{propertyFacts}}", propertyFacts],
    ["{{alternativeDescription}}", altDescriptions(altsToUse)],
    ["{{isRepeat}}", params.isRepeat ? "true" : "false"],
  ];
  for (const [token, value] of fills) userPrompt = fill(userPrompt, token, value);

  let body: string | null = null;
  let generatedByLLM = false;

  // Try the model up to twice before using the deterministic template. A reply that
  // fails validation (missing {{SIGNATURE}} or over length) or a transient API error
  // should not silently drop to the canned fallback — retry once first. The fallback
  // firing is recorded as generatedByLLM:false in metadata and surfaced on the review
  // dashboard so an invisible template swap is never mistaken for a model mistake.
  if (anthropic()) {
    for (let attempt = 0; attempt < 2 && !body; attempt++) {
      try {
        const out = await complete({ system: systemPrompt, user: userPrompt, maxTokens: 450 });
        let cleaned = out ? stripModelLinks(stripCodeFences(out)) : null;
        if (cleaned && cleaned.includes("{{SIGNATURE}}") && wordCount(cleaned) <= HARD + 12) {
          // Drop any alternative token the model emitted that we have no property for.
          for (let n = altsToUse.length + 1; n <= 3; n++) {
            const stray = new RegExp(`<p>\\s*\\{\\{ALT_${n}\\}\\}\\s*</p>`, "gi");
            cleaned = cleaned.replace(stray, "").replace(new RegExp(`\\{\\{ALT_${n}\\}\\}`, "g"), "");
          }
          body = cleaned;
          generatedByLLM = true;
        }
      } catch {
        /* retry, then fall through to the template */
      }
    }
  }

  if (!body) body = fallbackBody(firstName, propertyShort, availability, signOff, altsToUse, shape);

  // Insert our own anchors (the model never writes links), then sign.
  let resolved = body;
  altsToUse.forEach((a, i) => {
    resolved = resolved.replace(new RegExp(`\\{\\{ALT_${i + 1}\\}\\}`, "g"), altAnchor(a));
  });
  resolved = resolved.replace(/<p>\s*<\/p>/g, "");
  resolved = removeLongDashes(
    resolved.replace(/\{\{SIGNATURE\}\}/g, signatureFor(mailbox))
  );
  // With no signature after it, drop a dangling "<br>" left before the paragraph close
  // (so "Kind regards,<br>" doesn't leave a stray blank line before the mailbox block).
  resolved = resolved.replace(/<br\s*\/?>\s*<\/p>/gi, "</p>").replace(/<p>\s*<\/p>/g, "");
  // Hard guarantee on the banned house word: "happy" -> "delighted" (Rule 13), case-kept.
  resolved = resolved
    .replace(/\bHappy\b/g, "Delighted")
    .replace(/\bhappy\b/g, "delighted");

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
      alternatives: altsToUse.map((a) => ({ id: a.property.id, url: a.property.url })),
      factualQuestion: classification.factualQuestion,
    },
  };
}
