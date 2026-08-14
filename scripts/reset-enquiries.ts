import "./loadEnv";
import { assertShadowMode } from "../src/lib/env";
import { prisma } from "../src/lib/prisma";

// Clean slate for go-live: delete every processed enquiry (Decision rows cascade
// via onDelete: Cascade). Deliberately KEEPS Subscription and Property data so the
// live webhook + property matching keep working. Nothing here calls Claude or Graph.
async function main() {
  assertShadowMode();

  const before = await prisma.enquiry.count();
  console.log(`Enquiries currently in DB: ${before}`);

  const del = await prisma.enquiry.deleteMany({});
  console.log(`Deleted ${del.count} enquiries (decisions/drafts cascaded).`);

  const subs = await prisma.subscription.count();
  const props = await prisma.property.count();
  console.log(`Kept intact: ${subs} subscription(s), ${props} property record(s).`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
