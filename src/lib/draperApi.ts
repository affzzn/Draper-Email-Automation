// Read-only client for Draper's public property feed (WordPress REST API).
// It's the client's own site, unauthenticated and public. Be polite: a full pull
// is ~2 requests. No scraping, no HTML parsing.

const BASE = (process.env.DRAPER_API_BASE || "https://draperlondon.com").replace(/\/$/, "");

// Raw shape as returned by the feed. Everything arrives as strings.
export interface RawProperty {
  id: number;
  slug: string;
  link: string;
  status: string; // WP post status, e.g. "publish"
  modified_gmt?: string;
  title?: { rendered?: string };
  excerpt?: { rendered?: string };

  availability?: string; // "For Sale" | "Sold" | "Under Offer" | ...
  on_market?: string; // "yes" | "no"
  department?: string; // "residential-sales" | "residential-lettings" | ...
  property_type?: string;
  location?: string;
  tenure?: string;
  price_qualifier?: string;
  price_actual?: string;
  price?: string;
  price_formatted?: string;
  currency?: string;

  bedrooms?: string;
  bathrooms?: string;
  reception_rooms?: string;

  reference_number?: string;
  address_street?: string;
  address_two?: string;
  address_three?: string;
  address_four?: string;
  address_postcode?: string;
  latitude?: string;
  longitude?: string;

  features?: string[];
  description?: string;
  images?: { url?: string; large?: string; medium?: string; thumbnail?: string }[];
  office?: { name?: string };
  negotiator?: { name?: string };
  [key: string]: unknown;
}

// Fetch every property, paging via the X-WP-TotalPages header.
export async function fetchAllProperties(perPage = 100): Promise<RawProperty[]> {
  const all: RawProperty[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const url = `${BASE}/wp-json/wp/v2/property?per_page=${perPage}&page=${page}&orderby=modified&order=desc`;
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "Innate-DraperShadow/1.0 (property sync)" },
    });
    if (!res.ok) {
      throw new Error(`Property feed ${page} failed: ${res.status} ${res.statusText}`);
    }
    if (page === 1) {
      totalPages = Number(res.headers.get("X-WP-TotalPages") || "1");
    }
    const batch = (await res.json()) as RawProperty[];
    all.push(...batch);
    page++;
  } while (page <= totalPages);

  return all;
}
