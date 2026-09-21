"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { BookOpen, ExternalLink, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { categoryLabel, filterProducts, safeProductUrl, type CatalogProduct } from "@/lib/design/product-catalog";

function price(p: CatalogProduct) { return p.unit_price === null ? "Price needed" : new Intl.NumberFormat("en-US", { style: "currency", currency: p.currency }).format(p.unit_price); }
function label(key: string) { return key.replace(/_/g, " ").replace(/\bin\b/g, "(in)").replace(/^./, c => c.toUpperCase()); }
function Facts({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") return <span className="text-muted-foreground">Unverified</span>;
  if (Array.isArray(value)) return <ul className="space-y-1 list-disc pl-4">{value.map((v, i) => <li key={i}><Facts value={v} /></li>)}</ul>;
  if (typeof value === "object") return <dl className="space-y-2">{Object.entries(value).map(([k, v]) => <div key={k}><dt className="font-medium">{label(k)}</dt><dd className="text-muted-foreground"><Facts value={v} /></dd></div>)}</dl>;
  const url = safeProductUrl(value);
  return url ? <a className="underline text-primary break-all" href={url} target="_blank" rel="noopener noreferrer">View source</a> : <>{String(value)}</>;
}
function ProductImage({ product, large = false }: { product: CatalogProduct; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  return <div className={`${large ? "h-64" : "h-48"} bg-white rounded-lg flex items-center justify-center p-5`}>
    {product.imageUrl && !failed ? <Image src={product.imageUrl} alt={product.name} width={600} height={400} unoptimized onError={() => setFailed(true)} className="h-full w-full object-contain" /> : <div className="text-center text-slate-500 text-sm"><BookOpen className="mx-auto mb-2 h-8 w-8" />Product photo unavailable</div>}
  </div>;
}
const detailFields = ["dimensions_in", "cabinet_dimensions_in", "sink_geometry_in", "dimension_conflict", "dimension_status", "dimension_source", "material", "included_parts", "compatibility", "required_companions", "applications", "carton_coverage_sq_ft", "pieces_per_case", "price_per_sq_ft_displayed", "grout_reference", "trim_reference", "availability", "unverified", "notes"];

export function ProductCatalog({ products, updatedAt }: { products: CatalogProduct[]; updatedAt: string }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [sort, setSort] = useState("name");
  const [selected, setSelected] = useState<CatalogProduct | null>(null);
  const categories = useMemo(() => ["All", ...[...new Set(products.map(p => categoryLabel(p.category)))].sort()], [products]);
  const visible = useMemo(() => filterProducts(products, query, category, sort), [products, query, category, sort]);
  return <div className="mx-auto w-full max-w-7xl p-4 sm:p-6 pb-28 space-y-6">
    <div className="rounded-2xl border bg-gradient-to-br from-primary/10 to-background p-5 sm:p-7">
      <p className="text-xs font-semibold uppercase tracking-widest text-primary">Penney research library</p>
      <h1 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight">Find the right products for your design</h1>
      <p className="mt-3 max-w-2xl text-sm text-muted-foreground">Real products, dimensions, finishes and price references in one place. Open a product for included parts, compatibility and supplier specifications.</p>
      <p className="mt-3 text-xs text-muted-foreground">{products.length} products · Library published {updatedAt.slice(0, 10)} · Each price has its own check date</p>
    </div>
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input aria-label="Search products" placeholder="Search vanity, green, 60 inches, model number…" value={query} onChange={e => setQuery(e.target.value)} className="pl-9 h-10" /></div>
        <select aria-label="Sort products" value={sort} onChange={e => setSort(e.target.value)} className="h-10 rounded-md border bg-background px-3 text-sm"><option value="name">Name A–Z</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option></select>
      </div>
      <div className="flex flex-wrap gap-2" aria-label="Product categories">{categories.map(c => <Button key={c} variant={category === c ? "default" : "outline"} size="sm" aria-pressed={category === c} onClick={() => setCategory(c)}>{c}</Button>)}</div>
    </div>
    <div className="flex items-center justify-between text-sm"><p role="status">{visible.length} of {products.length} products</p>{(query || category !== "All") && <Button variant="ghost" size="sm" onClick={() => { setQuery(""); setCategory("All"); }}>Clear filters</Button>}</div>
    {visible.length === 0 ? <div className="rounded-xl border border-dashed p-12 text-center"><h2 className="font-semibold">No matching products</h2><p className="mt-2 text-sm text-muted-foreground">Try a different model, finish or category.</p></div> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{visible.map(p => <button key={p.id} onClick={() => setSelected(p)} className="text-left rounded-xl border bg-card overflow-hidden shadow-sm hover:border-primary/60 focus-visible:outline-2 focus-visible:outline-primary transition-colors">
      <ProductImage product={p} /><div className="p-4 space-y-2"><p className="text-xs font-medium text-primary">{categoryLabel(p.category)}</p><h2 className="font-semibold leading-snug">{p.name}</h2><p className="text-xs text-muted-foreground break-words">{p.model}</p><p className="text-sm">{p.finish}</p><p className="text-xs text-muted-foreground line-clamp-2">{p.dimensions}</p><p className="pt-2 text-xl font-semibold">{price(p)} <span className="text-xs font-normal text-muted-foreground">/ {p.price_unit}</span></p><p className="text-xs text-muted-foreground">{p.price_basis} · {p.checked_date}</p><p className="pt-2 text-sm font-medium text-primary">View product details →</p></div>
    </button>)}</div>}
    <p className="text-xs text-muted-foreground">Reference products are not approved selections. Published prices exclude tax, delivery, markup and installation. Confirm product fit and local availability before quoting or ordering.</p>
    <Dialog open={!!selected} onOpenChange={open => { if (!open) setSelected(null); }}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl">
      {selected && <><DialogHeader><DialogTitle className="pr-6">{selected.name}</DialogTitle><DialogDescription>{selected.model} · {selected.finish}</DialogDescription></DialogHeader>
        <ProductImage key={selected.id} product={selected} large />
        <div className="rounded-lg border p-4"><p className="text-2xl font-semibold">{price(selected)} <span className="text-sm font-normal">/ {selected.price_unit}</span></p><p className="mt-1 text-sm text-muted-foreground">{selected.price_basis} · Price checked {selected.checked_date}</p><p className="mt-3 text-sm">{selected.dimensions}</p></div>
        <div className="flex flex-wrap gap-2">{[["Supplier / price", selected.source_url], ["Manufacturer", selected.manufacturer_url], ["Specification sheet", selected.spec_url]].map(([title, raw]) => { const url = safeProductUrl(raw); return url ? <Button asChild variant="outline" size="sm" key={String(title)}><a href={url} target="_blank" rel="noopener noreferrer">{String(title)}<ExternalLink className="ml-2 h-3 w-3" /></a></Button> : null; })}</div>
        <div className="grid gap-4 sm:grid-cols-2">{detailFields.filter(k => selected[k] !== undefined).map(k => <section key={k} className="rounded-lg border p-4 text-sm break-words"><h3 className="font-semibold mb-2">{label(k)}</h3><Facts value={selected[k]} /></section>)}</div>
        <p className="text-xs text-muted-foreground">{selected.status}</p>
        <details className="border rounded-lg p-4 text-sm"><summary className="cursor-pointer font-medium">Price history</summary><div className="mt-3"><Facts value={selected.price_history} /></div></details>
      </>}
    </DialogContent></Dialog>
  </div>;
}
