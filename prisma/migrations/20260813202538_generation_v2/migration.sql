-- AlterEnum
ALTER TYPE "SuppressionReason" ADD VALUE 'repeat_enquiry';

-- AlterTable
ALTER TABLE "Enquiry" ADD COLUMN     "factualQuestion" TEXT;
