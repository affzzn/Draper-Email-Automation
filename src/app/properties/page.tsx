import { getPropertyRows } from "@/lib/store";

export const dynamic = "force-dynamic";

function money(n: number | null, formatted: string | null) {
  if (formatted) return formatted;
  return n ? `£${n.toLocaleString()}` : "";
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  }).format(new Date(iso));
}

const STATUS_CLASS: Record<string, string> = {
  for_sale: "green",
  to_let: "blue",
  under_offer: "amber",
  sold: "red",
  let: "mute",
  withdrawn: "mute",
  other: "mute",
};

function statusLabel(s: string) {
  return s.replace(/_/g, " ");
}

type SP = Record<string, string | undefined>;

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const all = (await getPropertyRows()).filter((p) => p.active);

  let list = all.filter((p) => {
    if (sp.channel && p.channel !== sp.channel) return false;
    if (sp.status && p.status !== sp.status) return false;
    if (sp.beds && (p.bedrooms ?? 0) < Number(sp.beds)) return false;
    if (sp.q) {
      const q = sp.q.toLowerCase();
      const hay = `${p.addressArea ?? ""} ${p.addressStreet ?? ""} ${p.postcode ?? ""} ${p.reference ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  list = list.sort((a, b) => {
    if (sp.sort === "price_asc") return (a.priceActual ?? 0) - (b.priceActual ?? 0);
    if (sp.sort === "newest") return (b.modifiedAt ?? "").localeCompare(a.modifiedAt ?? "");
    return (b.priceActual ?? 0) - (a.priceActual ?? 0);
  });

  const count = (s: string) => all.filter((p) => p.status === s).length;
  const properties = list.slice(0, 500);

  return (
    <div className="wrap">
      <h1 className="pagetitle">Properties</h1>

      <div className="stats">
        <div className="stat"><div className="n">{all.length}</div><div className="l">Active</div></div>
        <div className="stat"><div className="n">{count("for_sale")}</div><div className="l">For sale</div></div>
        <div className="stat"><div className="n">{count("to_let")}</div><div className="l">To let</div></div>
        <div className="stat"><div className="n">{count("under_offer")}</div><div className="l">Under offer</div></div>
        <div className="stat"><div className="n">{count("sold")}</div><div className="l">Sold</div></div>
      </div>

      <form className="controls" method="get">
        <input className="search" type="text" name="q" placeholder="Search area, street, postcode, ref…" defaultValue={sp.q ?? ""} />
        <select name="channel" defaultValue={sp.channel ?? ""}>
          <option value="">All channels</option>
          <option value="sales">sales</option>
          <option value="lettings">lettings</option>
        </select>
        <select name="status" defaultValue={sp.status ?? ""}>
          <option value="">All statuses</option>
          <option value="for_sale">for sale</option>
          <option value="to_let">to let</option>
          <option value="under_offer">under offer</option>
          <option value="sold">sold</option>
        </select>
        <select name="beds" defaultValue={sp.beds ?? ""}>
          <option value="">Any beds</option>
          {[1, 2, 3, 4, 5, 6, 7].map((b) => (<option key={b} value={b}>{b}+ beds</option>))}
        </select>
        <select name="sort" defaultValue={sp.sort ?? ""}>
          <option value="">Price (high → low)</option>
          <option value="price_asc">Price (low → high)</option>
          <option value="newest">Newest</option>
        </select>
        <button className="btn" type="submit">Filter</button>
        <a className="btn secondary" href="/properties">Reset</a>
      </form>

      <div className="tablewrap">
        <div className="tablescroll">
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Property</th>
                <th>Channel</th>
                <th>Status</th>
                <th>Price</th>
                <th>Beds</th>
                <th>Baths</th>
                <th>Recep</th>
                <th>Area</th>
                <th>Reference</th>
                <th>Updated</th>
                <th>Listing</th>
              </tr>
            </thead>
            <tbody>
              {properties.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.imageUrls[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="thumb" src={p.imageUrls[0]} alt="" loading="lazy" />
                    ) : (
                      <div className="thumb placeholder" />
                    )}
                  </td>
                  <td>
                    <div className="propaddr">{p.title ?? p.addressStreet ?? ""}</div>
                    <div className="small">{p.propertyType}</div>
                  </td>
                  <td>{p.channel}</td>
                  <td>
                    <span className={`pill ${STATUS_CLASS[p.status] ?? "mute"}`}>{statusLabel(p.status)}</span>
                  </td>
                  <td className="mono nowrap">
                    {money(p.priceActual, p.priceFormatted)}
                    {p.priceQualifier && <div className="small">{p.priceQualifier}</div>}
                  </td>
                  <td className="mono">{p.bedrooms ?? ""}</td>
                  <td className="mono">{p.bathrooms ?? ""}</td>
                  <td className="mono">{p.receptionRooms ?? ""}</td>
                  <td>
                    <div>{p.addressArea}</div>
                    <div className="small">{p.outcode}</div>
                  </td>
                  <td className="mono small">{p.reference}</td>
                  <td className="small nowrap">{fmtDate(p.modifiedAt)}</td>
                  <td>
                    <a className="linkbtn" href={p.url} target="_blank" rel="noreferrer">open</a>
                  </td>
                </tr>
              ))}
              {properties.length === 0 && (
                <tr><td colSpan={12} className="empty">No properties.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
