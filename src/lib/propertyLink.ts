import type { Property } from "@prisma/client";
import { prisma } from "./prisma";
import type { ParsedEnquiry } from "./parse";

// Resolve the enquiry's property against our local Property DB (synced from Draper's
// own feed). Portal refs are prefixed (Rightmove "83517_DRL260110"), so match the
// agency code token; otherwise fall back to the postcode in the address.
// NOTE: Zoopla's Postcode field is unreliable, so we match on the address text.
export async function resolvePropertyForEnquiry(
  enquiry: ParsedEnquiry
): Promise<Property | null> {
  if (enquiry.propertyReference) {
    const tokens = [
      enquiry.propertyReference,
      ...(enquiry.propertyReference.match(/[A-Z]{2,4}\d{5,}/gi) ?? []),
    ];
    const byRef = await prisma.property.findFirst({ where: { reference: { in: tokens } } });
    if (byRef) return byRef;
  }

  if (enquiry.propertyAddress) {
    const m = enquiry.propertyAddress.toUpperCase().match(/([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})/);
    if (m) {
      const outcode = m[1];
      const target = `${m[1]}${m[2]}`;
      const candidates = await prisma.property.findMany({ where: { outcode } });
      const hit = candidates.find(
        (p) => (p.postcode ?? "").toUpperCase().replace(/\s+/g, "") === target
      );
      if (hit) return hit;
    }
  }
  return null;
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
