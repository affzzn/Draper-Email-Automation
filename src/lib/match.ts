import type { Channel, Property } from "@prisma/client";
import { prisma } from "./prisma";

export interface MatchCriteria {
  channel: Channel;
  priceActual: number | null;
  bedrooms: number | null;
  outcode: string | null;
  excludePropertyId?: string;
  limit?: number;
  pricePct?: number; // default 0.20 (±20%)
  budgetMax?: number | null; // hard ceiling from the applicant's stated budget
  minScore?: number; // quality bar; matches below this are dropped
}

export interface ScoredProperty {
  property: Property;
  score: number;
  reasons: string[];
}

// Only properties a buyer could actually act on. Never suggest a sold one.
const AVAILABLE = ["for_sale", "to_let", "under_offer"] as const;

// Suggest similar available properties. ~140 rows total, so we fetch the plausible
// candidates and rank in memory rather than doing distance maths in SQL.
export async function findSimilar(c: MatchCriteria): Promise<ScoredProperty[]> {
  const pricePct = c.pricePct ?? 0.2;
  const limit = c.limit ?? 3;

  const priceLo = c.priceActual ? Math.round(c.priceActual * (1 - pricePct)) : undefined;
  let priceHi = c.priceActual ? Math.round(c.priceActual * (1 + pricePct)) : undefined;
  // Respect a stated budget as a hard ceiling (never suggest above it).
  if (c.budgetMax) priceHi = priceHi ? Math.min(priceHi, c.budgetMax) : c.budgetMax;

  const candidates = await prisma.property.findMany({
    where: {
      active: true,
      channel: c.channel,
      status: { in: [...AVAILABLE] },
      ...(c.excludePropertyId ? { id: { not: c.excludePropertyId } } : {}),
      ...(priceLo !== undefined || priceHi !== undefined
        ? { priceActual: { ...(priceLo !== undefined ? { gte: priceLo } : {}), ...(priceHi !== undefined ? { lte: priceHi } : {}) } }
        : {}),
      ...(c.bedrooms
        ? { bedrooms: { gte: c.bedrooms - 1, lte: c.bedrooms + 1 } }
        : {}),
    },
    take: 100,
  });

  const scored = candidates.map((p) => {
    let score = 0;
    const reasons: string[] = [];

    if (c.priceActual && p.priceActual) {
      const diff = Math.abs(p.priceActual - c.priceActual) / c.priceActual;
      const priceScore = Math.max(0, 1 - diff / pricePct); // 1 == exact, 0 == edge of band
      score += priceScore * 3;
      reasons.push(`price ${Math.round(diff * 100)}% away`);
    }
    if (c.bedrooms && p.bedrooms !== null) {
      const bedDiff = Math.abs(p.bedrooms - c.bedrooms);
      score += bedDiff === 0 ? 2 : bedDiff === 1 ? 1 : 0;
      reasons.push(`${p.bedrooms} bed`);
    }
    if (c.outcode && p.outcode) {
      if (p.outcode === c.outcode) {
        score += 2;
        reasons.push(`same area (${p.outcode})`);
      } else if (p.outcode.replace(/\d.*$/, "") === c.outcode.replace(/\d.*$/, "")) {
        score += 0.5;
        reasons.push(`nearby (${p.outcode})`);
      }
    }
    return { property: p, score, reasons };
  });

  const minScore = c.minScore ?? 0;
  return scored
    .filter((s) => s.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// Pick 1-2 genuinely-relevant alternatives for an enquiry. Quality bar applied:
// if nothing scores well, returns [] (a weak suggestion reads as automated).
export async function alternativesForEnquiry(opts: {
  channel: Channel;
  property: Property | null; // the enquired property, if we resolved it
  budgetMax: number | null;
  bedroomsHint: number | null; // e.g. parsed from "3+ bedroom property"
  outcodeHint: string | null; // e.g. from the enquiry address
  limit?: number;
}): Promise<ScoredProperty[]> {
  const priceSeed = opts.property?.priceActual ?? opts.budgetMax ?? null;
  const bedrooms = opts.property?.bedrooms ?? opts.bedroomsHint;
  const outcode = opts.property?.outcode ?? opts.outcodeHint;
  if (priceSeed === null && bedrooms === null) return []; // nothing to anchor on

  return findSimilar({
    channel: opts.channel,
    priceActual: priceSeed,
    bedrooms,
    outcode,
    excludePropertyId: opts.property?.id,
    budgetMax: opts.budgetMax,
    limit: opts.limit ?? 2,
    minScore: 3, // require a real match, not just "in the same channel"
  });
}

// v3 comparable: the strict "Anshika case" test. A genuinely close alternative in the
// same or adjacent postcode district, within 25% of the enquired price (or the stated
// budget), matching beds. Returns the single best, or null (never a weak fallback).
function agencyRefToken(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const m = ref.match(/[A-Z]{2,4}\d{5,}/i);
  return m ? m[0].toUpperCase() : ref.toUpperCase();
}
function postcodeKey(addr: string | null | undefined): string | null {
  if (!addr) return null;
  const m = addr.toUpperCase().match(/([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})/);
  return m ? `${m[1]}${m[2]}` : null;
}

export async function comparableForEnquiry(opts: {
  channel: Channel;
  seedPrice: number; // enquired property price, or stated budget
  seedBeds: number | null; // enquired property beds, or stated requirement
  requiredBeds: number | null; // applicant's explicitly stated bedroom requirement
  seedOutcode: string;
  budgetMax: number | null;
  excludePropertyId?: string | null;
  excludeRef?: string | null;
  excludeAddress?: string | null;
}): Promise<ScoredProperty | null> {
  const area = opts.seedOutcode.replace(/\d.*$/, ""); // "NW6" -> "NW"
  const priceLo = Math.round(opts.seedPrice * 0.75);
  let priceHi = Math.round(opts.seedPrice * 1.25);
  if (opts.budgetMax) priceHi = Math.min(priceHi, opts.budgetMax);

  const cands = await prisma.property.findMany({
    where: {
      active: true,
      channel: opts.channel,
      status: { in: [...AVAILABLE] },
      priceActual: { gte: priceLo, lte: priceHi },
      outcode: { startsWith: area },
      ...(opts.excludePropertyId ? { id: { not: opts.excludePropertyId } } : {}),
    },
    take: 100,
  });

  const excRef = agencyRefToken(opts.excludeRef);
  const excPc = postcodeKey(opts.excludeAddress);

  const scored: ScoredProperty[] = [];
  for (const p of cands) {
    if (excRef && p.reference && agencyRefToken(p.reference) === excRef) continue;
    if (excPc && p.postcode && p.postcode.toUpperCase().replace(/\s+/g, "") === excPc) continue;
    // Beds: exact match to a stated requirement, else within one of the enquired.
    if (opts.requiredBeds != null) {
      if (p.bedrooms !== opts.requiredBeds) continue;
    } else if (opts.seedBeds != null && p.bedrooms != null) {
      if (Math.abs(p.bedrooms - opts.seedBeds) > 1) continue;
    }
    let score = 0;
    const reasons: string[] = [];
    const pd = Math.abs(p.priceActual! - opts.seedPrice) / opts.seedPrice;
    score += Math.max(0, 1 - pd / 0.25) * 3;
    reasons.push(`price ${Math.round(pd * 100)}% away`);
    if (p.outcode === opts.seedOutcode) {
      score += 2;
      reasons.push(`same area (${p.outcode})`);
    } else {
      score += 0.5;
      reasons.push(`adjacent (${p.outcode})`);
    }
    if (opts.seedBeds != null && p.bedrooms != null) {
      score += p.bedrooms === opts.seedBeds ? 1 : 0.5;
    }
    scored.push({ property: p, score, reasons });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored[0] ?? null;
}

// Convenience: given one of our own properties (by reference), find its neighbours.
export async function findSimilarToReference(
  reference: string,
  limit = 3
): Promise<{ source: Property | null; matches: ScoredProperty[] }> {
  const source = await prisma.property.findFirst({ where: { reference } });
  if (!source) return { source: null, matches: [] };
  const matches = await findSimilar({
    channel: source.channel,
    priceActual: source.priceActual,
    bedrooms: source.bedrooms,
    outcode: source.outcode,
    excludePropertyId: source.id,
    limit,
  });
  return { source, matches };
}
