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
  const priceHi = c.priceActual ? Math.round(c.priceActual * (1 + pricePct)) : undefined;

  const candidates = await prisma.property.findMany({
    where: {
      active: true,
      channel: c.channel,
      status: { in: [...AVAILABLE] },
      ...(c.excludePropertyId ? { id: { not: c.excludePropertyId } } : {}),
      ...(priceLo !== undefined && priceHi !== undefined
        ? { priceActual: { gte: priceLo, lte: priceHi } }
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

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
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
