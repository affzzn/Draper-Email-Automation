-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('sales', 'lettings', 'commercial', 'other');

-- CreateEnum
CREATE TYPE "PropertyStatus" AS ENUM ('for_sale', 'to_let', 'under_offer', 'sold', 'let', 'withdrawn', 'other');

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "wpId" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "reference" TEXT,
    "channel" "Channel" NOT NULL DEFAULT 'other',
    "department" TEXT,
    "status" "PropertyStatus" NOT NULL DEFAULT 'other',
    "availability" TEXT,
    "onMarket" BOOLEAN NOT NULL DEFAULT false,
    "propertyType" TEXT,
    "tenure" TEXT,
    "priceActual" INTEGER,
    "priceQualifier" TEXT,
    "priceFormatted" TEXT,
    "currency" TEXT,
    "bedrooms" INTEGER,
    "bathrooms" INTEGER,
    "receptionRooms" INTEGER,
    "title" TEXT,
    "addressStreet" TEXT,
    "addressArea" TEXT,
    "postcode" TEXT,
    "outcode" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "description" TEXT,
    "imageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "officeName" TEXT,
    "negotiatorName" TEXT,
    "modifiedAt" TIMESTAMP(3),
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "raw" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Property_wpId_key" ON "Property"("wpId");

-- CreateIndex
CREATE INDEX "Property_channel_idx" ON "Property"("channel");

-- CreateIndex
CREATE INDEX "Property_status_idx" ON "Property"("status");

-- CreateIndex
CREATE INDEX "Property_priceActual_idx" ON "Property"("priceActual");

-- CreateIndex
CREATE INDEX "Property_bedrooms_idx" ON "Property"("bedrooms");

-- CreateIndex
CREATE INDEX "Property_outcode_idx" ON "Property"("outcode");

-- CreateIndex
CREATE INDEX "Property_reference_idx" ON "Property"("reference");

-- CreateIndex
CREATE INDEX "Property_active_idx" ON "Property"("active");
