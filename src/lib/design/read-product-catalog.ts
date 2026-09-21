import "server-only";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth/require-auth";
import { canViewDesignStudio } from "@/lib/auth/role-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { catalogSchema } from "./product-catalog";

export async function readProductCatalog() {
  const user = await requireAuth();
  if (!canViewDesignStudio(user.profile?.email ?? user.email)) notFound();
  const bucket = createAdminClient().storage.from("project-files");
  const { data, error } = await bucket.download("product-catalog/bathroom/catalog.json");
  if (error || !data) throw new Error("Product catalog could not be loaded");
  const catalog = catalogSchema.parse(JSON.parse(await data.text()));
  const paths = [...new Set(catalog.products.map(p => p.image).filter((p): p is string => typeof p === "string" && /^product-catalog\/bathroom\/images\/[a-zA-Z0-9._-]+$/.test(p)))];
  const signed = paths.length ? await bucket.createSignedUrls(paths, 3600) : { data: [] };
  const urls = new Map(signed.data?.map(p => [p.path, p.signedUrl]) ?? []);
  return { ...catalog, products: catalog.products.map(p => ({ ...p, imageUrl: urls.get(p.image ?? "") ?? null })) };
}
