// Run from the app checkout with node --env-file=.env.local scripts/publish-product-catalog.mjs <catalog-directory>.
// Publishes only reusable product research; never changes project selections.
import { readFile, writeFile } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const folder = resolve(process.argv[2] ?? "../catalog/bathroom");
const schema = z.array(z.object({ id: z.string().min(1), name: z.string(), model: z.string(), category: z.string(), dimensions: z.string(), finish: z.string(), currency: z.literal("USD"), unit_price: z.number().nonnegative().nullable(), price_basis: z.string(), price_unit: z.string(), checked_date: z.string(), source_url: z.string(), notes: z.string(), status: z.string(), image: z.string().nullable().optional() }).passthrough());
const products = schema.parse(JSON.parse(await readFile(resolve(folder, "products.json"), "utf8")));
if (!products.length || new Set(products.map(p => p.id)).size !== products.length) throw new Error("Empty catalog or duplicate IDs");
const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const bucket = client.storage.from("project-files");
const { data: bucketInfo, error: bucketError } = await client.storage.getBucket("project-files");
if (bucketError || !bucketInfo || bucketInfo.public) throw new Error("Catalog requires the existing private bucket");
for (const p of products) {
  delete p.spec_local_path;
  if (!p.image) continue;
  if (!/^images\/[a-zA-Z0-9._-]+\.(png|jpe?g|webp)$/i.test(p.image)) throw new Error(`Unsafe image path for ${p.id}`);
  const bytes = await readFile(resolve(folder, p.image));
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const imagePath = `product-catalog/bathroom/images/${hash}-${basename(p.image)}`;
  const contentType = p.image.endsWith(".png") ? "image/png" : p.image.endsWith(".webp") ? "image/webp" : "image/jpeg";
  const { error } = await bucket.upload(imagePath, bytes, { contentType, upsert: true, cacheControl: "31536000" });
  if (error) throw new Error(`Image upload failed for ${p.id}: ${error.message}`);
  p.image = imagePath;
}
const manifest = { updatedAt: new Date().toISOString(), products };
const payload = JSON.stringify(manifest);
// Images first, then an immutable backup and the live manifest: a failed upload leaves the last working catalog intact.
const backup = `product-catalog/bathroom/versions/${manifest.updatedAt.replace(/[:.]/g, "-")}.json`;
for (const path of [backup, "product-catalog/bathroom/catalog.json"]) {
  const { error } = await bucket.upload(path, payload, { contentType: "application/json", upsert: true, cacheControl: "0" });
  if (error) throw new Error(`Manifest upload failed: ${error.message}`);
}
const { data, error } = await bucket.download("product-catalog/bathroom/catalog.json");
if (error || !data || await data.text() !== payload) throw new Error("Published catalog readback failed");
await writeFile(resolve(folder, "app-publication.json"), JSON.stringify({ updatedAt: manifest.updatedAt, productCount: products.length, url: "https://www.penneyconstruction.build/design/catalog", backup }, null, 2));
console.log(`Published and verified ${products.length} catalog products in private storage.`);
