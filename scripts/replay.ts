import "./loadEnv";
import type { GraphMessage } from "../src/lib/graph";
import type { ParsedEnquiry } from "../src/lib/parse";
import { classify } from "../src/lib/classify";
import { matchPropertyForEnquiry, typeWord } from "../src/lib/propertyLink";
import { routeEnquiry, availabilityMap } from "../src/lib/routing";
import { decide } from "../src/lib/decide";
import { generateReply } from "../src/lib/generate";
import { mailboxByRole } from "../src/lib/mailboxes";
import { prisma } from "../src/lib/prisma";

// Replay: re-run every EXISTING enquiry through the CURRENT engine (v5 classifier,
// property matcher, router, reply generator) and update the stored rows in place, so
// the dashboard reflects exactly how the system handles them now. Nothing is sent.
// Pass --dry to preview without writing. Re-classifying + re-drafting calls Claude
// once per enquiry (classify) plus once per eligible enquiry (generate).

const MATCH_TRUST_THRESHOLD = 0.75;
const DRY = process.argv.includes("--dry");

function reconstructParsed(e: any): ParsedEnquiry {
  return {
    source: e.source,
    applicantName: e.applicantName,
    applicantEmail: e.applicantEmail,
    applicantPhone: e.applicantPhone,
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
    emailResolvedFrom: e.emailResolvedFrom,
    parseStatus: e.parseStatus,
    parseNotes: e.parseNotes ?? [],
  };
}

// Rebuild a minimal Graph message from stored fields for decide()'s header checks.
function reconstructMsg(e: any): GraphMessage {
  const raw = e.rawHeaders && typeof e.rawHeaders === "object" ? e.rawHeaders : {};
  const headers = Object.entries(raw).map(([name, value]) => ({
    name: String(name),
    value: String(value),
  }));
  return {
    id: e.graphMessageId,
    subject: e.rawSubject ?? "",
    conversationId: e.threadId ?? undefined,
    bodyPreview: e.messageBody ?? "",
    internetMessageHeaders: headers,
  } as GraphMessage;
}

async function main() {
  const isAvailable = await availabilityMap();
  const enquiries = await prisma.enquiry.findMany({
    include: { decision: true },
    orderBy: { receivedAt: "asc" },
  });
  console.log(
    `Replaying ${enquiries.length} enquiries through the current engine${DRY ? " (DRY — no writes)" : ""}…\n`
  );

  const stats = {
    total: 0,
    matched: 0,
    lowConf: 0,
    drafted: 0,
    withAlt: 0,
    routed: {} as Record<string, number>,
    intents: {} as Record<string, number>,
  };

  for (const e of enquiries) {
    stats.total++;
    const parsed = reconstructParsed(e);
    const msg = reconstructMsg(e);
    const mailboxAddress = mailboxByRole(e.mailbox).address;

    const classification = await classify(parsed, e.rawSubject ?? "");
    stats.intents[classification.intent] = (stats.intents[classification.intent] ?? 0) + 1;

    const enquiryChannel: "sales" | "lettings" =
      e.mailbox === "lettings" ? "lettings" : "sales";
    const match = await matchPropertyForEnquiry(parsed, enquiryChannel);
    const priceConfident =
      match.confidence >= MATCH_TRUST_THRESHOLD && match.property?.priceActual != null;
    if (match.property) stats.matched++;
    if (match.property && !priceConfident) stats.lowConf++;

    const route = routeEnquiry({
      channel: enquiryChannel,
      intent: classification.intent,
      price: match.property?.priceActual ?? null,
      priceConfident,
      isAvailable,
    });
    stats.routed[route.owner] = (stats.routed[route.owner] ?? 0) + 1;

    const decision = await decide({
      mailboxAddress,
      msg,
      parsed,
      classification,
      receivedAt: e.receivedAt,
      currentEnquiryId: e.id,
    });

    let generatedBody: string | null = null;
    let generationMetadata: object | null = null;
    let altCount = 0;
    if (decision.eligible && !decision.suppressed) {
      const reply = await generateReply({
        parsed,
        mailbox: e.mailbox,
        classification,
        isRepeat: !!decision.duplicateOf,
        property: priceConfident ? match.property : null,
        signOffName: route.owner,
      });
      generatedBody = reply.body;
      generationMetadata = reply.metadata;
      altCount = reply.metadata.alternatives.length;
      stats.drafted++;
      if (altCount > 0) stats.withAlt++;
    }

    const who = (parsed.applicantName ?? parsed.applicantEmail ?? "—").slice(0, 18);
    console.log(
      `${e.receivedAt.toISOString().slice(0, 10)} ${e.mailbox.padEnd(8)} ${who.padEnd(18)} ` +
        `${(classification.intent ?? "?").padEnd(17)} ${classification.confidence.toFixed(2)} | ` +
        `match ${match.method}(${Math.round(match.confidence * 100)}%) | → ${route.owner.padEnd(7)} | ` +
        `${decision.eligible && !decision.suppressed ? `DRAFT${altCount ? ` +${altCount} alt` : ""}` : `— (${decision.suppressionReason ?? decision.ineligibleReason ?? "not eligible"})`}`
    );

    if (DRY) continue;

    await prisma.enquiry.update({
      where: { id: e.id },
      data: {
        intent: classification.intent,
        confidence: classification.confidence,
        classifierRaw: classification.raw as object,
        factualQuestion: classification.factualQuestion,
        matchedPropertyId: match.property?.id ?? null,
        matchedPrice: match.property?.priceActual ?? null,
        matchedBedrooms: match.property?.bedrooms ?? null,
        matchedType: typeWord(match.property?.propertyType) ?? null,
        matchConfidence: match.confidence,
        matchMethod: match.method,
        routedTo: route.owner,
        routedReason: route.reason,
      },
    });

    const decisionData = {
      eligible: decision.eligible,
      ineligibleReason: decision.ineligibleReason,
      suppressed: decision.suppressed,
      suppressionReason: decision.suppressionReason,
      duplicateOf: decision.duplicateOf,
      wouldSendAtImmediate: decision.wouldSendAtImmediate,
      wouldSendAtHeld: decision.wouldSendAtHeld,
      generatedBody,
      generationMetadata: (generationMetadata ?? undefined) as object | undefined,
      // Reset any prior send state; freshness window keeps these old drafts unsent anyway.
      sendStatus: generatedBody ? "pending" : null,
      sentAt: null,
      sendError: null,
    };
    await prisma.decision.upsert({
      where: { enquiryId: e.id },
      create: { enquiryId: e.id, ...decisionData },
      update: decisionData,
    });
  }

  console.log(
    `\nSummary: ${stats.total} enquiries · ${stats.matched} matched a listing (${stats.lowConf} low-confidence) · ` +
      `${stats.drafted} drafted · ${stats.withAlt} carried an alternative.`
  );
  console.log("Intents:", Object.entries(stats.intents).map(([k, v]) => `${k}=${v}`).join(", "));
  console.log("Routed to:", Object.entries(stats.routed).map(([k, v]) => `${k}=${v}`).join(", "));
  if (DRY) console.log("\n(DRY run — nothing was written. Re-run without --dry to apply.)");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
