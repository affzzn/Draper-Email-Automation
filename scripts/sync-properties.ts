import "./loadEnv";
import { syncProperties } from "../src/lib/propertySync";
import { prisma } from "../src/lib/prisma";

// Pull Draper's property feed into the local Property table. Read-only on their
// site (~2 requests). Idempotent. Run on a schedule (daily is plenty).
async function main() {
  console.log("Syncing properties from Draper feed…");
  const r = await syncProperties();
  console.log(
    `✓ fetched ${r.fetched} · created ${r.created} · updated ${r.updated} · deactivated ${r.deactivated}`
  );

  const byStatus = await prisma.property.groupBy({
    by: ["channel", "status"],
    where: { active: true },
    _count: true,
  });
  console.log("\nActive inventory:");
  for (const g of byStatus.sort((a, b) => (a.channel + a.status).localeCompare(b.channel + b.status))) {
    console.log(`  ${g.channel.padEnd(10)} ${g.status.padEnd(12)} ${g._count}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
