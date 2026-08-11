import type { ParsedEnquiry } from "./parse";

// Spec §7.1. Reapit is NOT connected and must not be assumed. Interface exists so
// phase 3 is a swap; NullEnrichmentProvider is the default and must work.
export interface Enrichment {
  property_price: string | null;
  property_type: string | null;
  property_bedrooms: number | null;
  property_features: string[] | null;
  listing_summary: string | null;
  applicant_known_before: boolean | null; // always null in v1
  instruction_owner: string | null; // always null in v1
}

export interface EnrichmentProvider {
  enrich(enquiry: ParsedEnquiry): Promise<Enrichment | null>;
}

export class NullEnrichmentProvider implements EnrichmentProvider {
  async enrich(): Promise<Enrichment | null> {
    return null;
  }
}

// Placeholder for the optional listing fetcher (spec §7.1). NOT wired in v1.
// If ever built: respect robots.txt, rate-limit hard, cache by URL, non-fatal on
// failure — and if a portal blocks it, stop and tell Innate rather than working around it.
export class ListingEnrichmentProvider implements EnrichmentProvider {
  async enrich(): Promise<Enrichment | null> {
    return null; // intentionally inert until approved
  }
}

// Enrich from our local Property table (synced from Draper's own site feed).
// Matches the enquiry's property by reference, then by postcode. Off by default;
// enable with ENRICHMENT=property_db so shadow behaviour is unchanged unless chosen.
export class PropertyDbEnrichmentProvider implements EnrichmentProvider {
  async enrich(enquiry: ParsedEnquiry): Promise<Enrichment | null> {
    const { prisma } = await import("./prisma");
    let prop = null;

    // 1) By site reference. Portal refs are prefixed (e.g. Rightmove "83517_DRL260213"),
    //    so pull out the agency code tokens and match those.
    if (enquiry.propertyReference) {
      const tokens = [
        enquiry.propertyReference,
        ...(enquiry.propertyReference.match(/[A-Z]{2,4}\d{5,}/gi) ?? []),
      ];
      prop = await prisma.property.findFirst({
        where: { reference: { in: tokens } },
      });
    }

    // 2) By postcode extracted from the address (normalise spaces on both sides).
    if (!prop && enquiry.propertyAddress) {
      const m = enquiry.propertyAddress
        .toUpperCase()
        .match(/([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})/);
      if (m) {
        const outcode = m[1];
        const target = `${m[1]}${m[2]}`; // normalised, no space
        const candidates = await prisma.property.findMany({
          where: { outcode },
          select: {
            id: true, priceFormatted: true, priceActual: true, propertyType: true,
            bedrooms: true, features: true, description: true, postcode: true,
          },
        });
        const hit = candidates.find(
          (p) => (p.postcode ?? "").toUpperCase().replace(/\s+/g, "") === target
        );
        if (hit) {
          return {
            property_price: hit.priceFormatted ?? (hit.priceActual ? `£${hit.priceActual.toLocaleString()}` : null),
            property_type: hit.propertyType,
            property_bedrooms: hit.bedrooms,
            property_features: hit.features.length ? hit.features : null,
            listing_summary: hit.description,
            applicant_known_before: null,
            instruction_owner: null,
          };
        }
      }
    }
    if (!prop) return null;

    return {
      property_price: prop.priceFormatted ?? (prop.priceActual ? `£${prop.priceActual.toLocaleString()}` : null),
      property_type: prop.propertyType,
      property_bedrooms: prop.bedrooms,
      property_features: prop.features.length ? prop.features : null,
      listing_summary: prop.description,
      applicant_known_before: null,
      instruction_owner: null,
    };
  }
}

export const defaultEnricher: EnrichmentProvider = new NullEnrichmentProvider();

// Factory: pick the enricher from config. Default stays null (spec §7.1).
export function getEnricher(): EnrichmentProvider {
  if ((process.env.ENRICHMENT || "").toLowerCase() === "property_db") {
    return new PropertyDbEnrichmentProvider();
  }
  return defaultEnricher;
}
