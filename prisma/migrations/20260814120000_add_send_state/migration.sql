-- AlterTable: record real-send state on Decision (allowlisted test sending).
ALTER TABLE "Decision" ADD COLUMN     "sentAt" TIMESTAMP(3);
ALTER TABLE "Decision" ADD COLUMN     "sendStatus" TEXT;
ALTER TABLE "Decision" ADD COLUMN     "sendError" TEXT;
ALTER TABLE "Decision" ADD COLUMN     "sendResult" JSONB;
