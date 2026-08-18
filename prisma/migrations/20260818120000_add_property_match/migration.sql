-- Property match fields on Enquiry (spec §5.1): the listing this enquiry is about,
-- resolved once in the pipeline, with a confidence so a wrong match is visible.
ALTER TABLE "Enquiry" ADD COLUMN     "matchedPropertyId" TEXT;
ALTER TABLE "Enquiry" ADD COLUMN     "matchedPrice" INTEGER;
ALTER TABLE "Enquiry" ADD COLUMN     "matchedBedrooms" INTEGER;
ALTER TABLE "Enquiry" ADD COLUMN     "matchedType" TEXT;
ALTER TABLE "Enquiry" ADD COLUMN     "matchConfidence" DOUBLE PRECISION;
ALTER TABLE "Enquiry" ADD COLUMN     "matchMethod" TEXT;
