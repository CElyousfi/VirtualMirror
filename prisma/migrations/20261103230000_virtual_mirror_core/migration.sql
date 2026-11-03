-- Hand-written to match `prisma migrate dev` output for SQLite.
-- Verified by scripts/verify-migrations.mjs (applies all migrations to a fresh SQLite DB).

-- CreateTable
CREATE TABLE "Shop" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncAt" DATETIME,
    "lastSyncError" TEXT
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "shopifyGid" TEXT NOT NULL,
    "legacyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "productType" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "category" TEXT,
    "featuredImageUrl" TEXT,
    "imageCount" INTEGER NOT NULL,
    "variantCount" INTEGER NOT NULL,
    "snapshotJson" TEXT NOT NULL,
    "eyewearScore" REAL NOT NULL,
    "eyewearReasons" TEXT NOT NULL,
    "merchantDecision" TEXT,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Product_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Shop" ("shop") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantKey" TEXT NOT NULL,
    "variantLabel" TEXT NOT NULL,
    "variantIdsJson" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "readinessJson" TEXT NOT NULL,
    "specJson" TEXT NOT NULL,
    "anchorsJson" TEXT NOT NULL,
    "frameWidthM" REAL NOT NULL,
    "triangleCount" INTEGER NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "fileGid" TEXT,
    "fileUrl" TEXT,
    "fileStatus" TEXT,
    "merchantApprovedAt" DATETIME,
    "publishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Asset_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Shop" ("shop") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Asset_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Product_shop_eyewearScore_idx" ON "Product"("shop", "eyewearScore");

-- CreateIndex
CREATE UNIQUE INDEX "Product_shop_shopifyGid_key" ON "Product"("shop", "shopifyGid");

-- CreateIndex
CREATE INDEX "Asset_shop_state_idx" ON "Asset"("shop", "state");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_productId_variantKey_key" ON "Asset"("productId", "variantKey");
