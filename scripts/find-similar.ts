import "./loadEnv";
import { findSimilar, findSimilarToReference } from "../src/lib/match";
import { prisma } from "../src/lib/prisma";

// Demo the "similar properties" matcher.
//   npm run properties:match                 → picks a for-sale property and matches
//   npm run properties:match -- PRP18899967  → matches to a specific reference
function money(n: number | null) {
  return n ? `£${n.toLocaleString()}` : "n/a";
}

async function main() {
  const ref = process.argv[2];

  let source;
  let matches;
  if (ref) {
    ({ source, matches } = await findSimilarToReference(ref, 3));
    if (!source) {
      console.log(`No property with reference ${ref}`);
      await prisma.$disconnect();
      return;
    }
  } else {
    source = await prisma.property.findFirst({
      where: { active: true, status: "for_sale", priceActual: { not: null } },
      orderBy: { priceActual: "asc" },
    });
    if (!source) {
      console.log("No for-sale properties. Run: npm run properties:sync");
      await prisma.$disconnect();
      return;
    }
    matches = await findSimilar({
      channel: source.channel,
      priceActual: source.priceActual,
      bedrooms: source.bedrooms,
      outcode: source.outcode,
      excludePropertyId: source.id,
      limit: 3,
    });
  }

  console.log("SOURCE PROPERTY");
  console.log(`  ${source.title ?? source.addressStreet}`);
  console.log(`  ${money(source.priceActual)} · ${source.bedrooms} bed · ${source.outcode} · ${source.channel} · ${source.status}\n`);

  console.log(`SIMILAR (${matches.length})`);
  if (!matches.length) console.log("  (none within range)");
  for (const m of matches) {
    const p = m.property;
    console.log(`  • ${p.title ?? p.addressStreet}`);
    console.log(`    ${money(p.priceActual)} · ${p.bedrooms} bed · ${p.outcode} · score ${m.score.toFixed(2)} · ${m.reasons.join(", ")}`);
    console.log(`    ${p.url}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
