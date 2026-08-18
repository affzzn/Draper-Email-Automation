import { prisma } from "./prisma";

// Routing engine (§3). Config-driven so a rule change needs no deploy — the owners
// and the £2m threshold come from env, with next-week defaults baked in. This ships
// the general engine configured for w/c 17 August; the steady-state config (§3.3)
// and the weighted rotation (§3.6) are deliberately NOT built yet.

function envStr(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : fallback;
}
function envInt(name: string, fallback: number): number {
  const n = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const ROUTING = {
  thresholdGbp: envInt("ROUTE_THRESHOLD_GBP", 2_000_000), // §3.4: <£2m team, ≥£2m Craig
  salesUnder: envStr("ROUTE_SALES_UNDER", "Olivia"),
  salesOver: envStr("ROUTE_SALES_OVER", "Craig"),
  valuation: envStr("ROUTE_VALUATION", "Craig"), // §3.2: "all of them to me"
  lettings: envStr("ROUTE_LETTINGS", "Aaron"), // §3.2 / open decision 13.1
  fallback: envStr("ROUTE_FALLBACK", "Craig"), // price unknown / person unavailable
};

export interface RouteInput {
  channel: "sales" | "lettings" | "commercial" | "other";
  intent: string | null;
  price: number | null; // matchedPrice on the enquiry
  priceConfident: boolean; // matchConfidence >= trust threshold
  isAvailable: (name: string) => boolean; // §3.5 in/out overlay
}

export interface RouteResult {
  owner: string;
  reason: string;
}

// Pure decision — evaluated top to bottom, first match wins. Then the availability
// overlay: if the chosen owner is toggled out, fall through to the fallback (Craig).
export function routeEnquiry(input: RouteInput): RouteResult {
  const r = ROUTING;
  let owner: string;
  let reason: string;

  if (input.intent === "valuation_request") {
    owner = r.valuation;
    reason = "valuation → " + owner;
  } else if (input.channel === "lettings") {
    owner = r.lettings;
    reason = "lettings → " + owner;
  } else if (input.priceConfident && input.price != null) {
    // Sales with a confident price. Boundary: strictly below → team, ≥ → Craig (§3.4).
    if (input.price < r.thresholdGbp) {
      owner = r.salesUnder;
      reason = `sales, under £${r.thresholdGbp.toLocaleString()} → ${owner}`;
    } else {
      owner = r.salesOver;
      reason = `sales, £${r.thresholdGbp.toLocaleString()}+ → ${owner}`;
    }
  } else {
    // §3.7 interim: no trusted price, route to the fallback and flag it.
    owner = r.fallback;
    reason = "price unknown, routed by fallback";
  }

  // Availability overlay (§3.5). Craig is the ultimate fallback and is never skipped.
  if (owner !== r.fallback && !input.isAvailable(owner)) {
    reason = `${owner} unavailable → ${r.fallback}`;
    owner = r.fallback;
  }

  return { owner, reason };
}

// Availability, backed by the TeamMember table (§3.5). Deliberately one function so a
// calendar-aware check can replace it later. Loads the roster once per call site.
export async function availabilityMap(): Promise<(name: string) => boolean> {
  const rows = await prisma.teamMember.findMany();
  const byName = new Map(rows.map((m) => [m.name.toLowerCase(), m.available]));
  // Unknown names default to available (fail open); the fallback owner is always in.
  return (name: string) => byName.get(name.toLowerCase()) ?? true;
}
