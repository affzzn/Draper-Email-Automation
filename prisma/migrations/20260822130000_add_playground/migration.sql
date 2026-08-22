-- Prompt Playground (dev tool): saved prompt versions, run history, curated test sets.
-- Read-only sandbox — nothing here participates in the send path.

CREATE TABLE "PromptVersion" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PromptVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlaygroundRun" (
    "id" TEXT NOT NULL,
    "batchId" TEXT,
    "enquiryId" TEXT NOT NULL,
    "promptVersionId" TEXT,
    "promptName" TEXT NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "draftBody" TEXT NOT NULL,
    "shape" TEXT,
    "generatedByLLM" BOOLEAN NOT NULL DEFAULT false,
    "wordCount" INTEGER,
    "passCount" INTEGER NOT NULL DEFAULT 0,
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlaygroundRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlaygroundTestSet" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enquiryIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlaygroundTestSet_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PromptVersion_createdAt_idx" ON "PromptVersion"("createdAt");
CREATE INDEX "PlaygroundRun_batchId_idx" ON "PlaygroundRun"("batchId");
CREATE INDEX "PlaygroundRun_enquiryId_idx" ON "PlaygroundRun"("enquiryId");
CREATE INDEX "PlaygroundRun_createdAt_idx" ON "PlaygroundRun"("createdAt");

ALTER TABLE "PlaygroundRun" ADD CONSTRAINT "PlaygroundRun_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "Enquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaygroundRun" ADD CONSTRAINT "PlaygroundRun_promptVersionId_fkey" FOREIGN KEY ("promptVersionId") REFERENCES "PromptVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
