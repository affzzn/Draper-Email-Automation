import type { Channel, PropertyStatus, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { fetchAllProperties, type RawProperty } from "./draperApi";

function toInt(s: string | undefined | null): number | null {
  if (s === undefined || s === null || s === "") return null;
  const n = parseInt(String(s).replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

function toFloat(s: string | undefined | null): number | null {
  if (s === undefined || s === null || s === "") return null;
  const n = parseFloat(String(s));
  return Number.isFinite(n) ? n : null;
}

function stripHtml(s: string | undefined): string | null {
  if (!s) return null;
  const t = s
    .replace(/<[^>]+>/g, " ")
    .replace(/&pound;/gi, "£")
    .replace(/&amp;/gi, "&")
    .replace(/&#8217;|&#39;/g, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t || null;
}

function channelFrom(department: string | undefined): Channel {
  const d = (department || "").toLowerCase();
  if (d.includes("sales")) return "sales";
  if (d.includes("letting")) return "lettings";
  if (d.includes("commercial")) return "commercial";
  return "other";
}

// Derive a normalised status from the feed's free-text availability + on_market.
function statusFrom(availability: string | undefined, channel: Channel): PropertyStatus {
  const a = (availability || "").toLowerCase();
  if (/sold/.test(a)) return "sold";
  if (/let agreed/.test(a)) return "under_offer";
  if (/under offer|sstc|sold stc/.test(a)) return "under_offer";
  if (/^let\b|to let|to-let/.test(a)) return channel === "lettings" ? "to_let" : "other";
  if (/for sale|available/.test(a)) return "for_sale";
  if (/withdrawn|off market/.test(a)) return "withdrawn";
  // fall back on channel default when availability is blank
  if (channel === "lettings") return "to_let";
  if (channel === "sales") return "for_sale";
  return "other";
}

function outcodeFrom(postcode: string | undefined): string | null {
  if (!postcode) return null;
  const m = postcode.trim().toUpperCase().match(/^([A-Z]{1,2}\d[A-Z\d]?)/);
  return m ? m[1] : null;
}

function normalize(r: RawProperty): Prisma.PropertyCreateInput {
  const channel = channelFrom(r.department);
  const postcode = r.address_postcode?.trim() || null;
  const images = (r.images || []).map((i) => i.url || i.large || "").filter(Boolean);
  const description = stripHtml(r.description) || stripHtml(r.excerpt?.rendered);

  return {
    wpId: r.id,
    slug: r.slug,
    url: r.link,
    reference: r.reference_number || null,
    channel,
    department: r.department || null,
    status: statusFrom(r.availability, channel),
    availability: r.availability || null,
    onMarket: (r.on_market || "").toLowerCase() === "yes",
    propertyType: r.property_type || null,
    tenure: r.tenure || null,
    priceActual: toInt(r.price_actual ?? r.price),
    priceQualifier: r.price_qualifier || null,
    priceFormatted: stripHtml(r.price_formatted),
    currency: r.currency || null,
    bedrooms: toInt(r.bedrooms),
    bathrooms: toInt(r.bathrooms),
    receptionRooms: toInt(r.reception_rooms),
    title: stripHtml(r.title?.rendered),
    addressStreet: r.address_street || null,
    addressArea: r.location || null,
    postcode,
    outcode: outcodeFrom(postcode ?? undefined),
    latitude: toFloat(r.latitude),
    longitude: toFloat(r.longitude),
    features: Array.isArray(r.features) ? r.features.filter(Boolean) : [],
    description,
    imageUrls: images,
    officeName: r.office?.name || null,
    negotiatorName: r.negotiator?.name || null,
    modifiedAt: r.modified_gmt ? new Date(r.modified_gmt + "Z") : null,
    raw: r as unknown as Prisma.InputJsonValue,
  };
}

export interface SyncResult {
  fetched: number;
  created: number;
  updated: number;
  deactivated: number;
}

// Full sync: upsert everything in the feed, then mark anything no longer present
// as inactive (it left the site). Idempotent; safe to run on a schedule.
export async function syncProperties(): Promise<SyncResult> {
  const raw = await fetchAllProperties();
  const now = new Date();
  let created = 0;
  let updated = 0;
  const seenWpIds: number[] = [];

  for (const r of raw) {
    if (!r.id) continue;
    seenWpIds.push(r.id);
    const data = normalize(r);
    const existing = await prisma.property.findUnique({
      where: { wpId: r.id },
      select: { id: true },
    });
    if (existing) {
      await prisma.property.update({
        where: { wpId: r.id },
        data: { ...data, lastSeen: now, active: true },
      });
      updated++;
    } else {
      await prisma.property.create({
        data: { ...data, firstSeen: now, lastSeen: now, active: true },
      });
      created++;
    }
  }

  // Anything not in this pull has left the feed.
  const deactivated = await prisma.property.updateMany({
    where: { wpId: { notIn: seenWpIds }, active: true },
    data: { active: false },
  });

  return { fetched: raw.length, created, updated, deactivated: deactivated.count };
}
