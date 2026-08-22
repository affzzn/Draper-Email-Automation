import type { Property, PropertyStatus } from "@prisma/client";
import { prisma } from "./prisma";
import type { ParsedEnquiry } from "./parse";

export interface PropertyMatch {
  property: Property | null;
  confidence: number; // 0..1 (0 = no match)
  // reference | postcode | street_outcode | none, optionally suffixed with a
  // ":rejected(...)" reason when a fuzzy candidate failed the cross-check below.
  method: string;
}

// Never match an enquiry to a property that is gone. `sold`/`let`/`withdrawn` are excluded
// from ALL match paths so an enquiry can never resolve to a taken listing (which is what
// produced a live "sorry, it's sold" reply on an available flat). We keep the rows in the DB
// for audit; we just never MATCH them. `under_offer` stays matchable — the reply generator
// treats it as "unknown" availability and still offers a viewing.
const UNMATCHABLE_STATUSES: PropertyStatus[] = ["sold", "let", "withdrawn"];
const matchableStatus = { status: { notIn: UNMATCHABLE_STATUSES } };

// A fuzzy (non-reference) match must not contradict what the portal told us about the
// enquired property. If the matched listing's price is more than this far from the price
// stated in the lead, or its full postcode disagrees, the match is wrong — we cap its
// confidence below the trust threshold so it is shown but never drives the reply.
const PRICE_TOLERANCE = 0.15;
const REJECTED_CONFIDENCE = 0.4;

function crossCheckReason(
  candidate: Property,
  enquiry: ParsedEnquiry,
  fullPostcode: string | null
): string | null {
  // Full-postcode disagreement (both known): a fuzzy match landed on a different unit
  // on the same street / in the same outcode (e.g. NW8 9ES enquiry vs NW8 9ET listing).
  if (fullPostcode && candidate.postcode) {
    const cand = candidate.postcode.toUpperCase().replace(/\s+/g, "");
    if (cand !== fullPostcode) return `postcode ${cand} != enquiry ${fullPostcode}`;
  }
  // Stated listing price disagreement beyond tolerance (e.g. £2,395,000 vs stated £1,695,000).
  if (enquiry.listingPrice && candidate.priceActual) {
    const diff = Math.abs(candidate.priceActual - enquiry.listingPrice) / enquiry.listingPrice;
    if (diff > PRICE_TOLERANCE) {
      return `price ${candidate.priceActual} vs stated ${enquiry.listingPrice} (${Math.round(
        diff * 100
      )}% off)`;
    }
  }
  return null;
}

// Normalise free text for substring comparison: lowercase, strip punctuation.
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

// Match the enquiry's property against our local Property DB (synced from Draper's
// own feed), returning the best listing with a confidence and the method used. Order,
// strongest first: agency reference token, exact full postcode, then street name within
// the postcode district (the robust fallback for messy portal addresses). A wrong match
// is worse than none under live sending, so ambiguous street hits get a low confidence
// and callers can treat anything below their threshold as "no match".
export async function matchPropertyForEnquiry(
  enquiry: ParsedEnquiry,
  channel?: "sales" | "lettings"
): Promise<PropertyMatch> {
  // Match only within the enquiry's own channel so a sales enquiry never matches a
  // lettings listing on the same street (which would mis-route and mis-price it).
  const channelWhere = channel ? { channel } : {};
  // Every match path is scoped to matchable (not gone) listings — see UNMATCHABLE_STATUSES.
  const scope = { ...channelWhere, ...matchableStatus };

  const addr = enquiry.propertyAddress ?? "";
  const pcMatch = addr.toUpperCase().match(/([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})/);
  const fullPostcode = pcMatch ? `${pcMatch[1]}${pcMatch[2]}` : null;

  // A fuzzy candidate is only trusted if it does not contradict the lead's stated
  // price/postcode. On contradiction, keep it visible but cap confidence below trust.
  const finalizeFuzzy = (
    property: Property,
    confidence: number,
    method: string
  ): PropertyMatch => {
    const reason = crossCheckReason(property, enquiry, fullPostcode);
    return reason
      ? { property, confidence: Math.min(confidence, REJECTED_CONFIDENCE), method: `${method}:rejected(${reason})` }
      : { property, confidence, method };
  };

  // 1. Reference token, e.g. Rightmove "83517_DRL260039" -> "DRL260039". Matches the
  //    listing's own reference OR one of the refAliases recovered from asset filenames
  //    (needed because ~74% of listings carry a PRP reference_number, not the DRL ref).
  if (enquiry.propertyReference) {
    const ref = enquiry.propertyReference.toUpperCase();
    const tokens = Array.from(
      new Set([ref, ...(ref.match(/[A-Z]{2,4}\d{5,}/g) ?? [])])
    );
    const byRef = await prisma.property.findFirst({
      where: {
        OR: [{ reference: { in: tokens } }, { refAliases: { hasSome: tokens } }],
        ...scope,
      },
    });
    // A reference/alias hit is an exact id match — trusted as-is (no cross-check).
    if (byRef) return { property: byRef, confidence: 0.98, method: "reference" };
  }

  const outcode = pcMatch
    ? pcMatch[1]
    : addr.toUpperCase().match(/\b([A-Z]{1,2}\d[A-Z\d]?)\b/)?.[1] ?? null;

  // 2. Exact full postcode, when it uniquely identifies a listing.
  if (fullPostcode && pcMatch) {
    const byPc = (
      await prisma.property.findMany({ where: { outcode: pcMatch[1], ...scope } })
    ).filter(
      (p) => (p.postcode ?? "").toUpperCase().replace(/\s+/g, "") === fullPostcode
    );
    if (byPc.length === 1) {
      return finalizeFuzzy(byPc[0], 0.92, "postcode");
    }
    // >1 unit at the same postcode: fall through to street disambiguation.
  }

  // 3. Street name appearing within the enquiry address, scoped to the outcode.
  if (outcode) {
    const inOutcode = await prisma.property.findMany({ where: { outcode, ...scope } });
    const na = norm(addr);
    const hits = inOutcode
      .map((p) => ({ p, street: norm(p.addressStreet ?? "") }))
      .filter((x) => x.street.length >= 4 && na.includes(x.street));

    // Prefer a candidate whose full postcode also matches (near-certain).
    const pcHit = fullPostcode
      ? hits.find(
          (x) =>
            (x.p.postcode ?? "").toUpperCase().replace(/\s+/g, "") === fullPostcode
        )
      : undefined;
    if (pcHit) return finalizeFuzzy(pcHit.p, 0.9, "street_outcode");

    if (hits.length === 1) {
      return finalizeFuzzy(hits[0].p, 0.8, "street_outcode");
    }
    if (hits.length > 1) {
      // Same street, multiple units, no postcode to disambiguate: low confidence.
      hits.sort((a, b) => b.street.length - a.street.length);
      return finalizeFuzzy(hits[0].p, 0.5, "street_outcode");
    }
  }

  return { property: null, confidence: 0, method: "none" };
}

// Back-compat: just the property (used by the reply generator's fallback path).
export async function resolvePropertyForEnquiry(
  enquiry: ParsedEnquiry,
  channel?: "sales" | "lettings"
): Promise<Property | null> {
  return (await matchPropertyForEnquiry(enquiry, channel)).property;
}

// Turn "House - Detached" / "Flat Apartment" into a plain word: house / flat.
export function typeWord(propertyType: string | null | undefined): string | null {
  if (!propertyType) return null;
  const t = propertyType.toLowerCase();
  if (t.includes("flat") || t.includes("apartment") || t.includes("maisonette")) return "apartment";
  if (t.includes("house")) return "house";
  if (t.includes("bungalow")) return "bungalow";
  if (t.includes("studio")) return "studio";
  if (t.includes("penthouse")) return "penthouse";
  if (t.includes("mews")) return "mews house";
  return "property";
}

// Pull a short, clean street name out of a messy portal address (no number, no
// postcode, no "London"). "8, Lexham Mews, Lexham Mews, Kensington, London, W8..." -> "Lexham Mews".
export function shortStreet(address: string | null | undefined): string | null {
  if (!address) return null;
  const seen = new Set<string>();
  const parts = address
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !/^\d+[a-z]?$/i.test(s)) // drop pure house numbers
    .filter((s) => !/^[a-z]{1,2}\d[a-z\d]?(\s*\d[a-z]{2})?$/i.test(s)) // drop postcodes/outcodes
    .filter((s) => !/^(london|england|uk)$/i.test(s))
    .filter((s) => {
      const k = s.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  return parts[0] ?? null;
}
