import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { ProductCatalog } from "@/components/design/product-catalog";
import { readProductCatalog } from "@/lib/design/read-product-catalog";

export const metadata: Metadata = { title: "Product Catalog | Penney Construction" };
export const dynamic = "force-dynamic";

export default async function ProductCatalogPage() {
  const catalog = await readProductCatalog();
  return <><Header title="Product Catalog" subtitle="Design Studio" backHref="/design" backLabel="Design Studio" /><ProductCatalog products={catalog.products} updatedAt={catalog.updatedAt} /></>;
}
