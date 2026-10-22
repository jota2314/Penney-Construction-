"use client";
/* eslint-disable @next/next/no-img-element -- Private signed assets load directly without a shared image cache. */

import { useMemo, useState } from "react";
import { ArrowUpRight, CheckCircle2, Film, Image as ImageIcon, Instagram, Layers, Loader2, Plus, RefreshCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getMarketingLibrary } from "@/lib/actions/marketing";
import type { MarketingItem, MarketingProject } from "@/types/marketing";
import { coverAsset, displayDate, kindLabels, mediaAssets, messageOf, selectClass, statusLabels } from "./marketing-utils";
import { MarketingEditor } from "./marketing-editor";
import { MarketingDetail } from "./marketing-detail";

type Props = { initialItems: MarketingItem[]; projects: MarketingProject[]; initialError?: string };
const tabs = [{ value: "all", label: "All content", icon: Layers }, { value: "video", label: "Videos", icon: Film }, { value: "carousel", label: "Carousels", icon: Layers }, { value: "preview", label: "Previews", icon: ImageIcon }, { value: "image", label: "Images", icon: ImageIcon }] as const;

export function MarketingLibrary({ initialItems, projects: initialProjects, initialError }: Props) {
  const [items, setItems] = useState(initialItems);
  const [projects, setProjects] = useState(initialProjects);
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("all");
  const [project, setProject] = useState("all");
  const [search, setSearch] = useState("");
  const [error, setError] = useState(initialError || "");
  const [notice, setNotice] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ item: MarketingItem | null; linkOnly: boolean } | null>(null);

  const selected = items.find(item => item.id === selectedId);
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return items.filter(item => (kind === "all" || item.kind === kind) && (status === "all" || item.status === status) && (project === "all" || item.project_id === project || (project === "general" && !item.project_id)) && (!term || [item.title, item.description, item.caption, item.project?.name, item.project?.project_number].some(value => value?.toLocaleLowerCase().includes(term))));
  }, [items, kind, status, project, search]);
  const filteredByAnything = kind !== "all" || status !== "all" || project !== "all" || !!search.trim();

  const refresh = async () => {
    setRefreshing(true);
    try {
      const next = await getMarketingLibrary();
      if (next.error) throw new Error(next.error);
      setItems(next.items); setProjects(next.projects); setError("");
    } catch (refreshError) { setError(messageOf(refreshError)); throw refreshError; }
    finally { setRefreshing(false); }
  };
  const saved = async (id: string) => { await refresh(); setSelectedId(id); setNotice("Saved to your marketing library."); };
  const openNew = (linkOnly: boolean) => { setNotice(""); setSelectedId(null); setEditor({ item: null, linkOnly }); };
  const clearFilters = () => { setSearch(""); setKind("all"); setStatus("all"); setProject("all"); };

  return <div className="mx-auto w-full max-w-[1680px] space-y-7 p-4 pb-24 sm:p-6 sm:pb-24 xl:p-8 xl:pb-10">
    <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <div className="max-w-xl"><p className="mb-2 text-[11px] font-semibold uppercase tracking-[.2em] text-primary">Penney Construction</p><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Your work, ready to share.</h1><p className="mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground sm:text-base">Videos, carousels, and the posts that tell your story. Keep every version together, from first preview to Instagram.</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" className="h-10" onClick={() => openNew(true)}><Instagram />Add Instagram link</Button><Button className="h-10" onClick={() => openNew(false)}><Plus />Add content</Button></div>
    </div>
    {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-4"><p className="text-sm text-destructive">{error}</p><Button variant="outline" size="sm" disabled={refreshing} onClick={() => { void refresh().catch(() => undefined); }}><RefreshCw className={refreshing ? "animate-spin" : ""} />Try again</Button></div>}
    {notice && <div role="status" className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="size-4" /><span className="flex-1">{notice}</span><button type="button" aria-label="Dismiss notification" onClick={() => setNotice("")} className="p-1"><X className="size-4" /></button></div>}
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 border-b"><div className="-mb-px flex min-w-0 gap-4 overflow-x-auto sm:gap-6" aria-label="Content type">{tabs.map(tab => <button key={tab.value} type="button" onClick={() => setKind(tab.value)} aria-pressed={kind === tab.value} className={`flex shrink-0 items-center gap-2 border-b-2 pb-3 pt-1 text-sm font-medium transition-colors ${kind === tab.value ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{tab.label}<span className={`hidden rounded-full px-1.5 py-0.5 text-[10px] tabular-nums sm:inline ${kind === tab.value ? "bg-primary/10 text-primary" : "bg-muted"}`}>{tab.value === "all" ? items.length : items.filter(item => item.kind === tab.value).length}</span></button>)}</div><Button variant="ghost" size="icon-sm" className="mb-2 shrink-0" aria-label="Refresh library" title="Refresh library" disabled={refreshing} onClick={() => { void refresh().catch(() => undefined); }}><RefreshCw className={refreshing ? "animate-spin" : ""} /></Button></div>
      <div className="flex flex-col gap-3 sm:flex-row"><div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" /><Input aria-label="Search marketing library" className="h-10 rounded-lg pl-9 pr-9" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search content, captions, or projects…" />{search && <button type="button" aria-label="Clear search" onClick={() => setSearch("")} className="absolute right-2 top-2 p-1 text-muted-foreground"><X className="size-4" /></button>}</div><div className="grid grid-cols-2 gap-3 sm:flex"><select aria-label="Filter by status" className={`${selectClass} sm:w-36`} value={status} onChange={event => setStatus(event.target.value)}><option value="all">All statuses</option><option value="draft">Draft</option><option value="ready">Ready</option><option value="posted">Posted</option></select><select aria-label="Filter by project" className={`${selectClass} sm:max-w-56`} value={project} onChange={event => setProject(event.target.value)}><option value="all">All projects</option><option value="general">General marketing</option>{projects.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></div></div>
    </div>
    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><p>{filtered.length} {filtered.length === 1 ? "item" : "items"}{filteredByAnything ? ` of ${items.length}` : " in your library"}</p>{filteredByAnything ? <button type="button" onClick={clearFilters} className="font-medium text-foreground underline underline-offset-4">Clear filters</button> : <span>Recently updated</span>}</div>
    {refreshing && !items.length ? <div role="status" className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading your library…</div> : filtered.length ? <div className="grid grid-cols-1 gap-5 min-[520px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">{filtered.map(item => <MarketingCard key={item.id} item={item} onOpen={() => { setNotice(""); setSelectedId(item.id); }} />)}</div> : <div className="flex min-h-80 flex-col items-center justify-center rounded-2xl border border-dashed bg-muted/20 px-6 py-12 text-center"><div className="mb-5 flex size-14 items-center justify-center rounded-2xl border bg-background"><Layers className="size-6 text-primary" /></div><h2 className="text-xl font-semibold">{filteredByAnything ? "No matching content" : "A home for your best work"}</h2><p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{filteredByAnything ? "Try another search or clear the filters to see the rest of your library." : "Add your first video, carousel, or Instagram link. Keep the original files and the caption together so they are always easy to find."}</p>{filteredByAnything ? <Button variant="outline" className="mt-6" onClick={clearFilters}>Clear filters</Button> : <Button className="mt-6" onClick={() => openNew(false)}><Plus />Add your first item</Button>}</div>}
    {selected && !editor && <MarketingDetail key={selected.id} item={selected} onClose={() => setSelectedId(null)} onEdit={() => setEditor({ item: selected, linkOnly: false })} onRefresh={refresh} onArchived={async () => { await refresh(); setNotice("Item archived."); }} />}
    {editor && <MarketingEditor key={editor.item?.id || (editor.linkOnly ? "new-link" : "new-upload")} open item={editor.item} linkOnly={editor.linkOnly} projects={projects} onClose={() => setEditor(null)} onSaved={saved} />}
  </div>;
}

function MarketingCard({ item, onOpen }: { item: MarketingItem; onOpen: () => void }) {
  const cover = coverAsset(item);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const count = mediaAssets(item).length;
  const isVideo = cover?.mime_type.startsWith("video/");
  const KindIcon = item.kind === "video" ? Film : item.kind === "carousel" ? Layers : ImageIcon;
  return <button type="button" onClick={onOpen} className="group min-w-0 overflow-hidden rounded-2xl border bg-card text-left shadow-sm transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2" aria-label={`Open ${item.title}`}>
    <div className="relative aspect-[4/5] overflow-hidden bg-zinc-900">
      {cover?.url && cover.url !== failedUrl ? isVideo ? <video src={`${cover.url}#t=0.1`} preload="metadata" muted playsInline className="size-full object-cover" onError={() => setFailedUrl(cover.url)} aria-hidden="true" /> : <img src={cover.url} alt="" loading="lazy" className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.025]" onError={() => setFailedUrl(cover.url)} /> : <div className="flex size-full flex-col items-center justify-center gap-4 bg-[radial-gradient(ellipse_at_top,_#41403c,_#18181b)] px-8 text-center"><div className="rounded-2xl border border-white/15 bg-white/5 p-5">{item.instagram_url ? <Instagram className="size-9 text-white/70" /> : <KindIcon className="size-9 text-white/70" />}</div><p className="text-sm font-medium text-white/80">{item.instagram_url ? "Instagram post" : "Preview to come"}</p></div>}
      <span className={`absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium backdrop-blur-md ${item.status === "posted" ? "border-white/20 bg-white/95 text-zinc-800" : item.status === "ready" ? "border-emerald-200/20 bg-emerald-950/85 text-emerald-100" : "border-white/20 bg-black/45 text-white"}`}>{item.status === "posted" && <Instagram className="size-3" />}{statusLabels[item.status]}</span>
      {item.kind === "video" && <span className="absolute left-1/2 top-1/2 flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/40 bg-black/25 text-white backdrop-blur-sm"><svg viewBox="0 0 24 24" className="ml-1 size-6 fill-current" aria-hidden="true"><path d="M7 4v16l14-8z" /></svg></span>}
    </div>
    <div className="space-y-2 p-4"><div className="flex items-start justify-between gap-2"><h2 className="line-clamp-2 text-base font-semibold leading-snug">{item.title}</h2><ArrowUpRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" /></div><span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><KindIcon className="size-3.5" />{kindLabels[item.kind]}{item.kind === "carousel" && count > 0 ? ` · ${count} slides` : ""}</span><p className="truncate text-xs text-muted-foreground">{item.project?.name || "General marketing"}</p>{item.status === "posted" && item.posted_at && <p className="pt-1 text-[11px] text-muted-foreground">Posted {displayDate(item.posted_at)}</p>}</div>
  </button>;
}
