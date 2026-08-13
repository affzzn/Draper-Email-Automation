import "./loadEnv";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "../src/lib/prisma";

// Capture the current DB state into a committed JSON snapshot so the dashboard can
// be deployed read-only (e.g. on Vercel) with no database. Run: npm run snapshot
async function main() {
  const enquiries = await prisma.enquiry.findMany({
    include: { decision: true },
    orderBy: { receivedAt: "desc" },
  });
  const properties = await prisma.property.findMany({
    orderBy: { priceActual: "desc" },
  });

  const snapshot = {
    generatedAt: new Date().toISOString(),
    counts: { enquiries: enquiries.length, properties: properties.length },
    enquiries: enquiries.map((e) => ({
      id: e.id,
      mailbox: e.mailbox,
      receivedAt: e.receivedAt.toISOString(),
      source: e.source,
      applicantName: e.applicantName,
      applicantEmail: e.applicantEmail,
      applicantPhone: e.applicantPhone,
      emailResolvedFrom: e.emailResolvedFrom,
      propertyReference: e.propertyReference,
      propertyAddress: e.propertyAddress,
      propertyUrl: e.propertyUrl,
      messageBody: e.messageBody,
      budgetMax: e.budgetMax,
      budgetRaw: e.budgetRaw,
      requirements: e.requirements,
      interestedIn: e.interestedIn,
      aboutApplicant: e.aboutApplicant,
      replyTo: e.replyTo,
      threadId: e.threadId,
      parseStatus: e.parseStatus,
      parseNotes: e.parseNotes,
      intent: e.intent,
      confidence: e.confidence,
      factualQuestion: e.factualQuestion,
      gradedClassificationCorrect: e.gradedClassificationCorrect,
      gradingNote: e.gradingNote,
      assignedTo: e.assignedTo,
      rawSubject: e.rawSubject,
      rawBodyText: e.rawBodyText,
      rawBodyHtml: e.rawBodyHtml,
      decision: e.decision
        ? {
            eligible: e.decision.eligible,
            ineligibleReason: e.decision.ineligibleReason,
            suppressed: e.decision.suppressed,
            suppressionReason: e.decision.suppressionReason,
            duplicateOf: e.decision.duplicateOf,
            wouldSendAtImmediate: e.decision.wouldSendAtImmediate?.toISOString() ?? null,
            wouldSendAtHeld: e.decision.wouldSendAtHeld?.toISOString() ?? null,
            generatedBody: e.decision.generatedBody,
            generationMetadata: e.decision.generationMetadata,
          }
        : null,
    })),
    properties: properties.map((p) => ({
      id: p.id,
      wpId: p.wpId,
      slug: p.slug,
      url: p.url,
      reference: p.reference,
      channel: p.channel,
      status: p.status,
      availability: p.availability,
      onMarket: p.onMarket,
      propertyType: p.propertyType,
      tenure: p.tenure,
      priceActual: p.priceActual,
      priceQualifier: p.priceQualifier,
      priceFormatted: p.priceFormatted,
      currency: p.currency,
      bedrooms: p.bedrooms,
      bathrooms: p.bathrooms,
      receptionRooms: p.receptionRooms,
      title: p.title,
      addressStreet: p.addressStreet,
      addressArea: p.addressArea,
      postcode: p.postcode,
      outcode: p.outcode,
      latitude: p.latitude,
      longitude: p.longitude,
      features: p.features,
      description: p.description,
      imageUrls: p.imageUrls,
      modifiedAt: p.modifiedAt?.toISOString() ?? null,
      active: p.active,
    })),
  };

  // Real portal emails carry invalid UTF-8 / control bytes and lone surrogates, which
  // corrupt the JSON and break Next's build-time import. Strip them from every string.
  const clean = (value: unknown) =>
    typeof value === "string"
      ? Array.from(value)
          .filter((ch: string) => {
            const c = ch.codePointAt(0) ?? 0;
            if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) return false;
            if (c === 0x7f || c === 0xfffd) return false;
            if (c >= 0xd800 && c <= 0xdfff) return false;
            return true;
          })
          .join("")
      : value;

  const json = JSON.stringify(snapshot, (_k: string, v: unknown) => clean(v));
  JSON.parse(json); // fail loudly here if anything is still not valid JSON

  // Store base64-wrapped. The bundler inlines imported JSON as a JS string literal and
  // mangles some Unicode from real emails; base64 is pure ASCII, so it survives intact.
  const wrapped = JSON.stringify({ b64: Buffer.from(json, "utf8").toString("base64") });

  const dir = resolve(process.cwd(), "data");
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, "snapshot.json");
  writeFileSync(path, wrapped, "utf8");
  console.log(`✓ snapshot written: ${path}`);
  console.log(`  enquiries: ${snapshot.counts.enquiries} · properties: ${snapshot.counts.properties}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
