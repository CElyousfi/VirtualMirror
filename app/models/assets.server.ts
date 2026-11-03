import {
  applyMerchantOverrides,
  buildReport,
  canPublish,
  type AssetAnchors,
  type FrameSpec,
  type ReadinessReport,
} from "@vm/contracts";
import { groupVariantsForAssets, parseFrameDimensions, type ProductSnapshot } from "@vm/catalog";
import { PREPARATION_METHODS } from "@vm/engine-geometry";
import prisma from "../db.server";
import type { AdminGraphql } from "../lib/admin-client";
import { shopifyFilesStore } from "../services/asset-storage";
import { buildManifest, deleteManifest, writeManifest } from "../services/manifest";

/** Dimensions published in the listing become the known spec, tagged as manufacturer data. */
export function knownSpecFromSnapshot(s: ProductSnapshot): Partial<FrameSpec> {
  const d = parseFrameDimensions(s.title, s.description);
  const mk = (v?: number) => (v ? { valueMm: v, source: "manufacturer" as const } : undefined);
  return {
    lensWidth: mk(d.lensWidthMm),
    lensHeight: mk(d.lensHeightMm),
    bridgeWidth: mk(d.bridgeWidthMm),
    templeLength: mk(d.templeLengthMm),
    totalWidth: mk(d.totalWidthMm),
  };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "frame";

export interface PrepareRequest {
  shop: string;
  productId: string;
  variantKey: string;
  method: "existing-glb" | "demo-template";
  glb?: Uint8Array;
}

/**
 * Run a preparation method for one variant group, store the GLB in Shopify
 * Files when the result is usable, and record the asset. Re-preparing replaces
 * the previous asset and deletes its old file. Never publishes.
 */
export async function prepareAsset(admin: AdminGraphql, req: PrepareRequest) {
  const product = await prisma.product.findFirst({ where: { shop: req.shop, id: req.productId } });
  if (!product) throw new Error("Product not found for this shop.");
  const snapshot = JSON.parse(product.snapshotJson) as ProductSnapshot;
  const group = groupVariantsForAssets(snapshot).find((g) => g.key === req.variantKey);
  if (!group) throw new Error("This variant group no longer exists. Sync the catalog and try again.");

  const method = PREPARATION_METHODS[req.method];
  if (!method) throw new Error(`Unknown preparation method ${req.method}`);
  const input = {
    shopifyProductId: product.shopifyGid,
    variantKey: group.key,
    variantIds: group.variantLegacyIds,
    title: product.title,
    images: snapshot.images,
    glb: req.glb,
    knownSpec: knownSpecFromSnapshot(snapshot),
  };
  const eligibility = await method.canHandle(input);
  if (!eligibility.eligible) throw new Error(eligibility.reason ?? "This method cannot prepare this product.");

  const prepared = await method.prepare(input);
  const usable = prepared.readiness.state !== "failed" && prepared.readiness.state !== "unsupported";

  const store = shopifyFilesStore(admin);
  const stored = usable
    ? await store.putGlb(prepared.glb, `virtual-mirror-${slug(product.handle)}-${slug(group.label)}.glb`, `Virtual Mirror 3D frame: ${product.title} (${group.label})`)
    : null;

  const previous = await prisma.asset.findUnique({ where: { productId_variantKey: { productId: product.id, variantKey: group.key } } });
  const data = {
    shop: req.shop,
    productId: product.id,
    variantKey: group.key,
    variantLabel: group.label,
    variantIdsJson: JSON.stringify(group.variantLegacyIds),
    method: prepared.method,
    state: prepared.readiness.state,
    readinessJson: JSON.stringify(prepared.readiness),
    specJson: JSON.stringify(prepared.spec),
    anchorsJson: JSON.stringify(prepared.anchors),
    frameWidthM: prepared.frameWidthM,
    triangleCount: prepared.triangleCount,
    byteSize: prepared.glb.byteLength,
    fileGid: stored?.fileGid ?? null,
    fileUrl: stored?.url ?? null,
    fileStatus: stored?.status ?? null,
    merchantApprovedAt: null,
    publishedAt: null,
  };
  const asset = await prisma.asset.upsert({
    where: { productId_variantKey: { productId: product.id, variantKey: group.key } },
    create: data,
    update: data,
  });

  if (previous?.fileGid && previous.fileGid !== stored?.fileGid) {
    await store.delete(previous.fileGid).catch((e) => console.warn(`Old file cleanup failed: ${e}`));
  }
  // A replaced asset is no longer approved, so the storefront must be refreshed.
  if (previous?.publishedAt) await syncProductManifest(admin, req.shop, product.id);
  return asset;
}

/**
 * Merchant review: accept specific review-level checks and approve.
 * Blockers can never be accepted. Approval is only recorded if the
 * resulting state is Ready.
 */
export async function approveAsset(shop: string, assetId: string, acceptedCheckIds: string[]) {
  const asset = await prisma.asset.findFirst({ where: { shop, id: assetId } });
  if (!asset) throw new Error("Asset not found for this shop.");
  const report = JSON.parse(asset.readinessJson) as ReadinessReport;
  const checks = applyMerchantOverrides(report.checks, acceptedCheckIds);
  // Accepting the dimensions check means the merchant vouches for the size.
  const hasScale = report.hasScaleSource || acceptedCheckIds.includes("dimensions");
  const next = buildReport(checks, hasScale);
  // The merchant vouching for a size lets it go live, but it is still not a
  // published dimension: keep the original flag so the storefront says "estimated".
  next.hasScaleSource = report.hasScaleSource;
  const approved = next.state === "ready";
  return prisma.asset.update({
    where: { id: asset.id },
    data: {
      readinessJson: JSON.stringify(next),
      state: next.state,
      merchantApprovedAt: approved ? new Date() : null,
    },
  });
}

/** Rebuild and write (or delete) the storefront manifest for one product. */
export async function syncProductManifest(admin: AdminGraphql, shop: string, productId: string) {
  const product = await prisma.product.findFirst({ where: { shop, id: productId }, include: { assets: true } });
  if (!product) throw new Error("Product not found for this shop.");
  const published = product.assets.filter((a) => a.publishedAt);
  const manifest = buildManifest(
    published.map((a) => ({
      state: a.state === "published" ? "ready" : (a.state as ReadinessReport["state"]),
      merchantApprovedAt: a.merchantApprovedAt,
      fileUrl: a.fileUrl,
      variantIds: JSON.parse(a.variantIdsJson) as string[],
      label: a.variantLabel,
      bridgeM: (JSON.parse(a.anchorsJson) as AssetAnchors).bridge as [number, number, number],
      frameWidthM: a.frameWidthM,
      hasScaleSource: (JSON.parse(a.readinessJson) as ReadinessReport).hasScaleSource,
    })),
  );
  if (manifest) await writeManifest(admin, product.shopifyGid, manifest);
  else await deleteManifest(admin, product.shopifyGid);
  return manifest;
}

export async function publishAsset(admin: AdminGraphql, shop: string, assetId: string) {
  const asset = await prisma.asset.findFirst({ where: { shop, id: assetId } });
  if (!asset) throw new Error("Asset not found for this shop.");
  const rule = canPublish(asset.state as ReadinessReport["state"], asset.merchantApprovedAt);
  if (!rule.allowed) throw new Error(rule.reason);
  if (!asset.fileUrl) throw new Error("The 3D file is not stored yet.");
  await prisma.asset.update({ where: { id: asset.id }, data: { state: "published", publishedAt: new Date() } });
  try {
    return await syncProductManifest(admin, shop, asset.productId);
  } catch (err) {
    await prisma.asset.update({ where: { id: asset.id }, data: { state: asset.state, publishedAt: null } });
    throw err;
  }
}

export async function unpublishAsset(admin: AdminGraphql, shop: string, assetId: string) {
  const asset = await prisma.asset.findFirst({ where: { shop, id: assetId } });
  if (!asset) throw new Error("Asset not found for this shop.");
  await prisma.asset.update({ where: { id: asset.id }, data: { state: "ready", publishedAt: null } });
  return syncProductManifest(admin, shop, asset.productId);
}

export async function removeAsset(admin: AdminGraphql, shop: string, assetId: string) {
  const asset = await prisma.asset.findFirst({ where: { shop, id: assetId } });
  if (!asset) return;
  await prisma.asset.delete({ where: { id: asset.id } });
  if (asset.publishedAt) await syncProductManifest(admin, shop, asset.productId);
  if (asset.fileGid) await shopifyFilesStore(admin).delete(asset.fileGid);
}
