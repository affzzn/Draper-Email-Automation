// Data-source abstraction so the dashboard runs either from the live DB (local dev)
// or from a committed JSON snapshot (read-only deploy on Vercel, no database).
//
// Mode: DATA_SOURCE = "db" | "snapshot". Default: "db" if DATABASE_URL is set,
// otherwise "snapshot". On Vercel, set DATA_SOURCE=snapshot.
import snapshotJson from "../../data/snapshot.json";

export interface DecisionRow {
  eligible: boolean;
  ineligibleReason: string | null;
  suppressed: boolean;
  suppressionReason: string | null;
  duplicateOf: string | null;
  wouldSendAtImmediate: string | null;
  wouldSendAtHeld: string | null;
  generatedBody: string | null;
  generationMetadata: { availability?: string; alternatives?: { url: string }[] } | null;
}

export interface EnquiryRow {
  id: string;
  mailbox: string;
  receivedAt: string;
  source: string;
  applicantName: string | null;
  applicantEmail: string | null;
  applicantPhone: string | null;
  emailResolvedFrom: string;
  propertyReference: string | null;
  propertyAddress: string | null;
  propertyUrl: string | null;
  messageBody: string | null;
  budgetMax: number | null;
  budgetRaw: string | null;
  requirements: string | null;
  interestedIn: string | null;
  aboutApplicant: string | null;
  replyTo: string | null;
  threadId: string | null;
  parseStatus: string;
  parseNotes: string[];
  intent: string | null;
  confidence: number | null;
  factualQuestion: string | null;
  gradedClassificationCorrect: boolean | null;
  gradingNote: string | null;
  assignedTo: string | null;
  rawSubject: string;
  rawBodyText: string;
  rawBodyHtml: string;
  decision: DecisionRow | null;
}

export interface PropertyRow {
  id: string;
  wpId: number;
  slug: string;
  url: string;
  reference: string | null;
  channel: string;
  status: string;
  availability: string | null;
  onMarket: boolean;
  propertyType: string | null;
  tenure: string | null;
  priceActual: number | null;
  priceQualifier: string | null;
  priceFormatted: string | null;
  currency: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  receptionRooms: number | null;
  title: string | null;
  addressStreet: string | null;
  addressArea: string | null;
  postcode: string | null;
  outcode: string | null;
  latitude: number | null;
  longitude: number | null;
  features: string[];
  description: string | null;
  imageUrls: string[];
  modifiedAt: string | null;
  active: boolean;
}

interface Snapshot {
  generatedAt: string;
  counts: { enquiries: number; properties: number };
  enquiries: EnquiryRow[];
  properties: PropertyRow[];
}

const snapshot = snapshotJson as unknown as Snapshot;

function mode(): "db" | "snapshot" {
  const explicit = (process.env.DATA_SOURCE || "").toLowerCase();
  if (explicit === "snapshot" || explicit === "db") return explicit;
  return process.env.DATABASE_URL ? "db" : "snapshot";
}

export function isReadOnly(): boolean {
  return mode() === "snapshot";
}

export function snapshotGeneratedAt(): string | null {
  return mode() === "snapshot" ? snapshot.generatedAt : null;
}

export async function getEnquiryRows(): Promise<EnquiryRow[]> {
  if (mode() === "snapshot") return snapshot.enquiries;

  const { prisma } = await import("./prisma");
  const rows = await prisma.enquiry.findMany({
    include: { decision: true },
    orderBy: { receivedAt: "desc" },
  });
  return rows.map((e) => ({
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
          generationMetadata: e.decision.generationMetadata as DecisionRow["generationMetadata"],
        }
      : null,
  }));
}

export async function getPropertyRows(): Promise<PropertyRow[]> {
  if (mode() === "snapshot") return snapshot.properties;

  const { prisma } = await import("./prisma");
  const rows = await prisma.property.findMany({ orderBy: { priceActual: "desc" } });
  return rows.map((p) => ({
    ...p,
    modifiedAt: p.modifiedAt?.toISOString() ?? null,
  }));
}
