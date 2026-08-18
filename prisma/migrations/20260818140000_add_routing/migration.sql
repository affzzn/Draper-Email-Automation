-- Routing (§3): who the engine allocated the enquiry to, and why.
ALTER TABLE "Enquiry" ADD COLUMN     "routedTo" TEXT;
ALTER TABLE "Enquiry" ADD COLUMN     "routedReason" TEXT;

-- Per-person in/out availability (§3.5), toggled from the dashboard.
CREATE TABLE "TeamMember" (
    "name" TEXT NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("name")
);

-- Seed next week's roster: everyone in, Mitchell out (w/c 17 Aug).
INSERT INTO "TeamMember" ("name", "available", "updatedAt") VALUES
  ('Craig',    true,  NOW()),
  ('Olivia',   true,  NOW()),
  ('Aaron',    true,  NOW()),
  ('Mitchell', false, NOW());
