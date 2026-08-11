-- CreateEnum
CREATE TYPE "Mailbox" AS ENUM ('sales', 'lettings', 'hello');

-- CreateEnum
CREATE TYPE "Source" AS ENUM ('rightmove', 'zoopla', 'website', 'direct', 'unknown');

-- CreateEnum
CREATE TYPE "ParseStatus" AS ENUM ('full', 'partial', 'failed');

-- CreateEnum
CREATE TYPE "EmailResolvedFrom" AS ENUM ('from', 'reply_to', 'body', 'none');

-- CreateEnum
CREATE TYPE "Intent" AS ENUM ('viewing_request', 'valuation_request', 'landlord_enquiry', 'tenant_or_maintenance', 'supplier', 'recruitment', 'press', 'spam', 'other');

-- CreateEnum
CREATE TYPE "SuppressionReason" AS ENUM ('auto_responder_guard', 'one_reply_per_thread', 'human_replied_first', 'ineligible_intent');

-- CreateTable
CREATE TABLE "Enquiry" (
    "id" TEXT NOT NULL,
    "graphMessageId" TEXT NOT NULL,
    "mailbox" "Mailbox" NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "source" "Source" NOT NULL DEFAULT 'unknown',
    "applicantName" TEXT,
    "applicantEmail" TEXT,
    "applicantPhone" TEXT,
    "propertyReference" TEXT,
    "propertyAddress" TEXT,
    "propertyUrl" TEXT,
    "messageBody" TEXT,
    "rawSubject" TEXT NOT NULL,
    "rawHeaders" JSONB NOT NULL,
    "rawBodyHtml" TEXT NOT NULL DEFAULT '',
    "rawBodyText" TEXT NOT NULL DEFAULT '',
    "replyTo" TEXT,
    "isReplyAllRequired" BOOLEAN,
    "threadId" TEXT,
    "parseStatus" "ParseStatus" NOT NULL DEFAULT 'failed',
    "parseNotes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "emailResolvedFrom" "EmailResolvedFrom" NOT NULL DEFAULT 'none',
    "intent" "Intent",
    "confidence" DOUBLE PRECISION,
    "classifierRaw" JSONB,
    "gradedClassificationCorrect" BOOLEAN,
    "gradingNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Enquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "eligible" BOOLEAN NOT NULL DEFAULT false,
    "ineligibleReason" TEXT,
    "suppressed" BOOLEAN NOT NULL DEFAULT false,
    "suppressionReason" "SuppressionReason",
    "duplicateOf" TEXT,
    "wouldSendAtImmediate" TIMESTAMP(3),
    "wouldSendAtHeld" TIMESTAMP(3),
    "generatedBody" TEXT,
    "generationMetadata" JSONB,
    "transportRecord" JSONB,
    "assignmentRecord" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "mailbox" "Mailbox" NOT NULL,
    "resource" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "clientState" TEXT NOT NULL,
    "notificationUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeltaState" (
    "mailbox" "Mailbox" NOT NULL,
    "deltaLink" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeltaState_pkey" PRIMARY KEY ("mailbox")
);

-- CreateIndex
CREATE UNIQUE INDEX "Enquiry_graphMessageId_key" ON "Enquiry"("graphMessageId");

-- CreateIndex
CREATE INDEX "Enquiry_mailbox_idx" ON "Enquiry"("mailbox");

-- CreateIndex
CREATE INDEX "Enquiry_intent_idx" ON "Enquiry"("intent");

-- CreateIndex
CREATE INDEX "Enquiry_parseStatus_idx" ON "Enquiry"("parseStatus");

-- CreateIndex
CREATE INDEX "Enquiry_receivedAt_idx" ON "Enquiry"("receivedAt");

-- CreateIndex
CREATE INDEX "Enquiry_threadId_idx" ON "Enquiry"("threadId");

-- CreateIndex
CREATE INDEX "Enquiry_applicantEmail_idx" ON "Enquiry"("applicantEmail");

-- CreateIndex
CREATE UNIQUE INDEX "Decision_enquiryId_key" ON "Decision"("enquiryId");

-- CreateIndex
CREATE INDEX "Subscription_mailbox_idx" ON "Subscription"("mailbox");

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "Enquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
