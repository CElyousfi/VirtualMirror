// Applies every Prisma migration, in order, to a fresh in-memory SQLite database
// using Node's built-in node:sqlite, then checks tenant cascade deletes.
// Usage: node scripts/verify-migrations.mjs
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dirname, "..", "prisma", "migrations");
const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON;");
const migrations = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
for (const m of migrations) {
  db.exec(readFileSync(join(dir, m, "migration.sql"), "utf8"));
  console.log(`applied ${m}`);
}
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);
console.log("tables:", tables.join(", "));
for (const t of ["Session", "Shop", "Product", "Asset"]) if (!tables.includes(t)) throw new Error(`missing table ${t}`);

const now = new Date().toISOString();
db.prepare(`INSERT INTO Shop (shop) VALUES (?)`).run("a.myshopify.com");
db.prepare(`INSERT INTO Shop (shop) VALUES (?)`).run("b.myshopify.com");
const insP = db.prepare(`INSERT INTO Product (id, shop, shopifyGid, legacyId, title, handle, productType, vendor, status, imageCount, variantCount, snapshotJson, eyewearScore, eyewearReasons, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
insP.run("p1", "a.myshopify.com", "gid://shopify/Product/1", "1", "A", "a", "", "", "ACTIVE", 0, 1, "{}", 1, "[]", now);
insP.run("p2", "b.myshopify.com", "gid://shopify/Product/1", "1", "B", "b", "", "", "ACTIVE", 0, 1, "{}", 1, "[]", now);
db.prepare(`INSERT INTO Asset (id, shop, productId, variantKey, variantLabel, variantIdsJson, method, state, readinessJson, specJson, anchorsJson, frameWidthM, triangleCount, byteSize, updatedAt) VALUES ('a1','a.myshopify.com','p1','default','All','["*"]','existing-glb','ready','{}','{}','{}',0.14,100,1000,?)`).run(now);

// Same Shopify GID in two shops must be allowed (tenant isolation by composite key).
let dup = false;
try { insP.run("p3", "a.myshopify.com", "gid://shopify/Product/1", "1", "A2", "a", "", "", "ACTIVE", 0, 1, "{}", 1, "[]", now); } catch { dup = true; }
if (!dup) throw new Error("expected unique (shop, shopifyGid) violation");

db.prepare(`DELETE FROM Shop WHERE shop = ?`).run("a.myshopify.com");
const left = db.prepare(`SELECT shop, (SELECT COUNT(*) FROM Asset) AS assets FROM Product`).all();
if (left.length !== 1 || left[0].shop !== "b.myshopify.com" || left[0].assets !== 0) throw new Error(`cascade failed: ${JSON.stringify(left)}`);
console.log("OK: unique (shop, shopifyGid) enforced; deleting a shop cascades to its products and assets only");
