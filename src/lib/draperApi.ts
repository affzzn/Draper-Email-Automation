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
  floorplans?: { url?: string; large?: string; medium?: string; thumbnail?: string }[];
  epcs?: { url?: string; large?: string; medium?: string; thumbnail?: string }[];
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
      headers: {
        Accept: "application/json",
        // A browser-like UA: some managed hosts serve an HTML block/challenge page to
        // non-browser agents from datacenter IPs (which is why the Render cron fails with
        // "Unexpected token '<'"). If the host blocks purely on datacenter IP this won't be
        // enough on its own — the real fix is to allowlist the sync's egress IP host-side.
        "User-Agent":
          process.env.DRAPER_API_UA ||
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      },
    });
    if (!res.ok) {
      throw new Error(`Property feed page ${page} failed: ${res.status} ${res.statusText}`);
    }
    if (page === 1) {
      totalPages = Number(res.headers.get("X-WP-TotalPages") || "1");
    }
    // Fail LOUDLY and clearly when the body is not JSON. A managed host / WAF that blocks
    // this IP returns an HTML page with a 200 status, which sails past the res.ok check and
    // then throws a cryptic `JSON.parse` error. Detect it and surface the real cause + a
    // snippet so the failure is diagnosable from the cron log.
    const contentType = res.headers.get("content-type") || "";
    const text = await res.text();
    if (!contentType.includes("json") || /^\s*<(?:!doctype|html)/i.test(text)) {
      const snippet = text.slice(0, 200).replace(/\s+/g, " ").trim();
      throw new Error(
        `Property feed page ${page} returned non-JSON (content-type: ${
          contentType || "none"
        }). This is almost certainly a WAF/host block page served to this IP, not a real ` +
          `response. Allowlist the sync's egress IP on Draper's host. Body starts: ${snippet}`
      );
    }
    let batch: RawProperty[];
    try {
      batch = JSON.parse(text) as RawProperty[];
    } catch {
      throw new Error(
        `Property feed page ${page}: body was not valid JSON. Body starts: ${text
          .slice(0, 200)
          .replace(/\s+/g, " ")
          .trim()}`
      );
    }
    all.push(...batch);
    page++;
  } while (page <= totalPages);

  return all;
}
