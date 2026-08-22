-- Add reference aliases recovered from asset filenames so Rightmove DRL leads can
-- reference-match listings whose feed reference_number is a PRP id.
ALTER TABLE "Property" ADD COLUMN "refAliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
