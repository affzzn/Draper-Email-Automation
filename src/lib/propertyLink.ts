import type { Property } from "@prisma/client";
import { prisma } from "./prisma";
import type { ParsedEnquiry } from "./parse";

export interface PropertyMatch {
  property: Property | null;
  confidence: number; // 0..1 (0 = no match)
  method: "reference" | "postcode" | "street_outcode" | "none";
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
  enquiry: ParsedEnquiry
): Promise<PropertyMatch> {
  // 1. Reference token, e.g. Rightmove "83517_DRL260039" -> "DRL260039".
  if (enquiry.propertyReference) {
    const ref = enquiry.propertyReference.toUpperCase();
    const tokens = Array.from(
      new Set([ref, ...(ref.match(/[A-Z]{2,4}\d{5,}/g) ?? [])])
    );
    const byRef = await prisma.property.findFirst({
      where: { reference: { in: tokens } },
    });
    if (byRef) return { property: byRef, confidence: 0.98, method: "reference" };
  }

  const addr = enquiry.propertyAddress ?? "";
  const pcMatch = addr.toUpperCase().match(/([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})/);
  const fullPostcode = pcMatch ? `${pcMatch[1]}${pcMatch[2]}` : null;
  const outcode = pcMatch
    ? pcMatch[1]
    : addr.toUpperCase().match(/\b([A-Z]{1,2}\d[A-Z\d]?)\b/)?.[1] ?? null;

  // 2. Exact full postcode, when it uniquely identifies a listing.
  if (fullPostcode && pcMatch) {
    const byPc = (
      await prisma.property.findMany({ where: { outcode: pcMatch[1] } })
    ).filter(
      (p) => (p.postcode ?? "").toUpperCase().replace(/\s+/g, "") === fullPostcode
    );
    if (byPc.length === 1) {
      return { property: byPc[0], confidence: 0.92, method: "postcode" };
    }
    // >1 unit at the same postcode: fall through to street disambiguation.
  }

  // 3. Street name appearing within the enquiry address, scoped to the outcode.
  if (outcode) {
    const inOutcode = await prisma.property.findMany({ where: { outcode } });
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
    if (pcHit) return { property: pcHit.p, confidence: 0.9, method: "street_outcode" };

    if (hits.length === 1) {
      return { property: hits[0].p, confidence: 0.8, method: "street_outcode" };
    }
    if (hits.length > 1) {
      // Same street, multiple units, no postcode to disambiguate: low confidence.
      hits.sort((a, b) => b.street.length - a.street.length);
      return { property: hits[0].p, confidence: 0.5, method: "street_outcode" };
    }
  }

  return { property: null, confidence: 0, method: "none" };
}

// Back-compat: just the property (used by the reply generator's fallback path).
export async function resolvePropertyForEnquiry(
  enquiry: ParsedEnquiry
): Promise<Property | null> {
  return (await matchPropertyForEnquiry(enquiry)).property;
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
