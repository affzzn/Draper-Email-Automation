import { isReadOnly } from "@/lib/mode";
import { PRODUCTION_SYSTEM_PROMPT } from "@/lib/playground";
import Playground, {
  type PickerEnquiry,
  type VersionItem,
  type TestSetItem,
  type RunHistoryItem,
} from "./Playground";

export const dynamic = "force-dynamic";

export default async function PlaygroundPage() {
  if (isReadOnly()) {
    return (
      <div className="wrap">
        <h1 className="pagetitle">Playground</h1>
        <div className="pg-note">
          The Playground needs the live database. This is a read-only snapshot deploy, so
          prompt testing is disabled here.
        </div>
      </div>
    );
  }

  const { prisma } = await import("@/lib/prisma");

  const [rawEnquiries, versions, testSets, runs] = await Promise.all([
    prisma.enquiry.findMany({
      orderBy: { receivedAt: "desc" },
      take: 400,
      select: {
        id: true,
        applicantName: true,
        propertyAddress: true,
        propertyReference: true,
        mailbox: true,
        intent: true,
        receivedAt: true,
        matchMethod: true,
        decision: { select: { generatedBody: true, generationMetadata: true } },
      },
    }),
    prisma.promptVersion.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.playgroundTestSet.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.playgroundRun.findMany({
      orderBy: { createdAt: "desc" },
      take: 24,
      select: {
        id: true,
        enquiryId: true,
        promptName: true,
        shape: true,
        generatedByLLM: true,
        wordCount: true,
        passCount: true,
        failCount: true,
        draftBody: true,
        batchId: true,
        createdAt: true,
        enquiry: { select: { applicantName: true, propertyAddress: true, propertyReference: true } },
      },
    }),
  ]);

  const enquiries: PickerEnquiry[] = rawEnquiries.map((e) => {
    const meta = e.decision?.generationMetadata as { shape?: string } | null;
    return {
      id: e.id,
      applicant: e.applicantName,
      property: e.propertyAddress ?? e.propertyReference,
      mailbox: e.mailbox,
      intent: e.intent,
      shape: meta?.shape ?? null,
      hasMatch: !!e.matchMethod && e.matchMethod !== "none",
      hasDraft: !!e.decision?.generatedBody,
      receivedAt: e.receivedAt.toISOString(),
    };
  });

  const versionItems: VersionItem[] = versions.map((v) => ({
    id: v.id,
    name: v.name,
    systemPrompt: v.systemPrompt,
    note: v.note,
    createdAt: v.createdAt.toISOString(),
  }));

  const testSetItems: TestSetItem[] = testSets.map((t) => ({
    id: t.id,
    name: t.name,
    enquiryIds: t.enquiryIds,
    createdAt: t.createdAt.toISOString(),
  }));

  const history: RunHistoryItem[] = runs.map((r) => ({
    id: r.id,
    enquiryId: r.enquiryId,
    applicant: r.enquiry?.applicantName ?? null,
    property: r.enquiry?.propertyAddress ?? r.enquiry?.propertyReference ?? null,
    promptName: r.promptName,
    shape: r.shape,
    generatedByLLM: r.generatedByLLM,
    wordCount: r.wordCount,
    passCount: r.passCount,
    failCount: r.failCount,
    draftBody: r.draftBody,
    batchId: r.batchId,
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <Playground
      productionPrompt={PRODUCTION_SYSTEM_PROMPT}
      enquiries={enquiries}
      versions={versionItems}
      testSets={testSetItems}
      history={history}
    />
  );
}
