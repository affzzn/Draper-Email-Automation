import "./loadEnv";
import { assertShadowMode } from "../src/lib/env";
import { processMessage } from "../src/lib/pipeline";
import type { GraphMessage } from "../src/lib/graph";
import { prisma } from "../src/lib/prisma";
import type { Mailbox } from "@prisma/client";

// Feed synthetic messages through the full pipeline so you can watch the review UI
// populate without waiting for real Graph traffic (spec §8 testing).
// Usage: npm run simulate

function msg(overrides: Partial<GraphMessage> & { id: string }): GraphMessage {
  return {
    receivedDateTime: new Date().toISOString(),
    conversationId: `conv-${overrides.id}`,
    body: { contentType: "html", content: "" },
    internetMessageHeaders: [],
    ...overrides,
  };
}

const samples: { mailbox: Mailbox; message: GraphMessage }[] = [
  {
    mailbox: "sales",
    message: msg({
      id: `sim-viewing-${Date.now()}`,
      subject: "New enquiry via Rightmove — 12 Elgin Crescent, W11",
      from: { emailAddress: { name: "Rightmove", address: "noreply@rightmove.co.uk" } },
      replyTo: [{ emailAddress: { name: "Sarah Jones", address: "sarah.jones@gmail.com" } }],
      body: {
        contentType: "html",
        content:
          "<p>You have a new enquiry.</p>" +
          "<p>Name: Sarah Jones;<br>Email: sarah.jones@gmail.com;<br>Phone: 07700 900123;<br>" +
          "PropAddress: 12 Elgin Crescent, Notting Hill, W11;<br>PropReference: DL-4821;<br>PropPrice: £1,250,000;<br>" +
          "Message: Hi, I'd love to arrange a viewing for this property. I'm available most evenings this week.;</p>",
      },
    }),
  },
  {
    mailbox: "lettings",
    message: msg({
      id: `sim-tenant-${Date.now()}`,
      subject: "URGENT: water leak in bathroom",
      from: { emailAddress: { name: "Tom Baker", address: "tom.baker@outlook.com" } },
      body: {
        contentType: "html",
        content:
          "<p>Hi, I'm a current tenant at 5 Landor Road. There's a leak under the bathroom sink and it's getting worse. Please send someone. Thanks, Tom</p>",
      },
    }),
  },
  {
    mailbox: "sales",
    message: msg({
      id: `sim-supplier-${Date.now()}`,
      subject: "Partnership opportunity — boost your listings",
      from: { emailAddress: { name: "GrowthAds", address: "sales@growthads.io" } },
      internetMessageHeaders: [{ name: "Precedence", value: "bulk" }],
      body: {
        contentType: "html",
        content: "<p>Hi, we help estate agents get more leads. Can we book a call to discuss advertising?</p>",
      },
    }),
  },
  {
    mailbox: "sales",
    message: msg({
      id: `sim-valuation-${Date.now()}`,
      subject: "Valuation request for my flat",
      from: { emailAddress: { name: "Priya Shah", address: "priya.shah@gmail.com" } },
      body: {
        contentType: "html",
        content:
          "<p>Name: Priya Shah;<br>Email: priya.shah@gmail.com;<br>Message: I'd like to get my flat in Clapham valued as I'm thinking of selling. What's my property worth?;</p>",
      },
    }),
  },
];

async function main() {
  assertShadowMode();
  for (const s of samples) {
    const res = await processMessage(s.mailbox, s.message);
    console.log(
      `→ ${s.mailbox}: "${s.message.subject}" ⇒ enquiry ${res.enquiryId || "(skipped)"} (${res.created ? "new" : "existing"})`
    );
  }
  console.log("\nDone. Open http://localhost:3000 to grade them.");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
