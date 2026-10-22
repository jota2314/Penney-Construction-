"use client";
/* eslint-disable @next/next/no-img-element -- Private signed assets load directly without a shared image cache. */

import { useState } from "react";
import { Archive, Check, ChevronLeft, ChevronRight, Copy, Download, ExternalLink, FileText, Instagram, Layers, Pencil, Play, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSwipeCarousel } from "@/hooks/use-swipe-carousel";
import type { MarketingItem } from "@/types/marketing";
import { archiveMarketingItem } from "@/lib/actions/marketing";
import { coverAsset, displayDate, downloadUrl, fileSize, kindLabels, mediaAssets, messageOf, statusLabels } from "./marketing-utils";

type Props = { item: MarketingItem; initialSlideIndex?: number; onClose: () => void; onEdit: () => void; onRefresh: () => Promise<void>; onArchived: () => Promise<void> };

export function MarketingDetail({ item, initialSlideIndex = 0, onClose, onEdit, onRefresh, onArchived }: Props) {
  const media = mediaAssets(item);
  const cover = coverAsset(item);
  const slides = media.length ? media : cover ? [cover] : [];
  const [requestedSlideIndex, setSlideIndex] = useState(initialSlideIndex);
  const slideIndex = Math.min(Math.max(0, requestedSlideIndex), Math.max(0, slides.length - 1));
  const selected = slides[slideIndex];
  const [copied, setCopied] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [failedUrls, setFailedUrls] = useState<Record<string, string>>({});

  const changeSlide = (next: number) => setSlideIndex(Math.min(Math.max(0, next), Math.max(0, slides.length - 1)));
  const swipe = useSwipeCarousel({ count: slides.length, index: slideIndex, onIndexChange: changeSlide });
  const canSwipe = slides.length > 1 && selected?.mime_type.startsWith("image/");
  const copyCaption = async () => {
    try { await navigator.clipboard.writeText(item.caption || ""); setCopied(true); window.setTimeout(() => setCopied(false), 2000); }
    catch { setError("Could not copy automatically. Select the caption below and copy it."); }
  };
  const archive = async () => {
    setBusy(true); setError("");
    try { const result = await archiveMarketingItem(item.id); if (result.error) throw new Error(result.error); await onArchived(); onClose(); }
    catch (archiveError) { setError(messageOf(archiveError)); }
    finally { setBusy(false); }
  };
  const refreshMedia = async () => {
    setBusy(true);
    try { await onRefresh(); setFailedUrls({}); }
    catch (refreshError) { setError(messageOf(refreshError)); }
    finally { setBusy(false); }
  };

  const unavailablePreview = (failed: boolean) => <div className="flex flex-col items-center px-8 text-center">
    {item.instagram_url && !failed ? <Instagram className="mb-4 size-12 text-white/60" /> : <Play className="mb-4 size-12 text-white/60" />}
    <p className="text-lg font-medium">{failed ? "Preview could not load" : item.instagram_url ? "Saved from Instagram" : "No preview added yet"}</p>
    <p className="mt-2 max-w-xs text-sm text-white/60">{failed ? "Refresh the preview, or download the original file below." : item.instagram_url ? "Open the original post, or add its video and cover to your library." : "Add a video, carousel slides, or a cover image."}</p>
    {failed ? <Button className="mt-5" variant="secondary" disabled={busy} onClick={refreshMedia}><RefreshCw className={busy ? "animate-spin" : ""} />Refresh preview</Button> : item.instagram_url ? <Button asChild className="mt-5" variant="secondary"><a href={item.instagram_url} target="_blank" rel="noopener noreferrer">Open Instagram<ExternalLink /></a></Button> : null}
  </div>;

  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[94dvh] gap-0 overflow-y-auto p-0 sm:max-w-5xl" showCloseButton={!busy}>
      <div className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_minmax(320px,.8fr)]">
        <div className="min-w-0 bg-zinc-950 text-white">
          <div
            className="relative flex aspect-[4/5] max-h-[67dvh] items-center justify-center overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-400 lg:max-h-none"
            role="region"
            aria-label={`${item.title} preview`}
            aria-roledescription={slides.length > 1 ? "carousel" : undefined}
            tabIndex={canSwipe ? 0 : undefined}
            style={{ touchAction: canSwipe ? "pan-y" : "auto" }}
            {...(canSwipe ? swipe.handlers : {})}
            onKeyDown={event => {
              if (!canSwipe || event.altKey || event.ctrlKey || event.metaKey) return;
              if (event.target instanceof HTMLElement && event.target.closest("input,textarea,select,video,[contenteditable='true']")) return;
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault(); event.stopPropagation();
              changeSlide(slideIndex + (event.key === "ArrowRight" ? 1 : -1));
            }}
          >
            {slides.length ? <div className="absolute inset-0 flex size-full motion-reduce:!transition-none" style={swipe.trackStyle}>
              {slides.map((asset, index) => {
                const failed = !!asset.url && failedUrls[asset.id] === asset.url;
                const active = index === slideIndex;
                const markFailed = () => setFailedUrls(previous => ({ ...previous, [asset.id]: asset.url || "" }));
                return <div key={asset.id} className="flex size-full shrink-0 items-center justify-center" aria-hidden={!active} inert={!active}>
                  {asset.url && !failed ? asset.mime_type.startsWith("video/") ? active ? <video src={asset.url} controls playsInline preload="metadata" poster={cover?.mime_type.startsWith("image/") ? cover.url || undefined : undefined} onError={markFailed} className="size-full object-contain" aria-label={item.title} /> : <Play className="size-12 text-white/60" /> : asset.mime_type.startsWith("image/") ? <img src={asset.url} alt={`${item.title} — slide ${index + 1}`} loading={Math.abs(index - slideIndex) <= 1 ? "eager" : "lazy"} draggable={false} onError={markFailed} className="size-full select-none object-contain" /> : <div className="px-8 text-center"><FileText className="mx-auto mb-3 size-10 text-white/50" /><p className="text-sm">This file is available in Downloads.</p></div> : unavailablePreview(failed)}
                </div>;
              })}
            </div> : unavailablePreview(false)}
            {slides.length > 1 && <><button type="button" aria-label="Previous slide" disabled={slideIndex === 0} onClick={() => changeSlide(slideIndex - 1)} className="absolute left-3 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/55 backdrop-blur transition-colors hover:bg-black/80 disabled:invisible"><ChevronLeft className="size-5" /></button><button type="button" aria-label="Next slide" disabled={slideIndex === slides.length - 1} onClick={() => changeSlide(slideIndex + 1)} className="absolute right-3 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/55 backdrop-blur transition-colors hover:bg-black/80 disabled:invisible"><ChevronRight className="size-5" /></button><span aria-live="polite" className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-white/15 bg-black/60 px-3 py-1 text-xs tabular-nums backdrop-blur">{slideIndex + 1} / {slides.length}</span></>}
          </div>
          {slides.length > 1 && <div className="flex gap-2 overflow-x-auto border-t border-white/10 p-3" aria-label="Carousel slides">{slides.map((asset, index) => <button key={asset.id} type="button" onClick={() => changeSlide(index)} className={`relative flex h-16 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border-2 ${index === slideIndex ? "border-orange-400" : "border-transparent opacity-60 hover:opacity-100"}`} aria-label={`View slide ${index + 1}`} aria-current={index === slideIndex ? "true" : undefined}>{asset.url && asset.mime_type.startsWith("image/") ? <img src={asset.url} alt="" className="size-full object-cover" /> : <Play className="size-4" />}<span className="absolute bottom-0 right-0 rounded-tl bg-black/70 px-1 text-[10px]">{index + 1}</span></button>)}</div>}
        </div>
        <div className="min-w-0 space-y-6 p-5 sm:p-7">
          <DialogHeader className="pr-5 text-left">
            <div className="mb-2 flex flex-wrap items-center gap-2"><span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">{item.kind === "carousel" ? <Layers className="size-3.5" /> : item.kind === "video" ? <Play className="size-3.5" /> : null}{kindLabels[item.kind]}</span><span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">{statusLabels[item.status]}</span></div>
            <DialogTitle className="text-2xl leading-tight">{item.title}</DialogTitle>
            <DialogDescription>{item.project?.name || "General marketing"}{item.status === "posted" && item.posted_at ? ` · Posted ${displayDate(item.posted_at)}` : ` · Added ${displayDate(item.created_at)}`}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={onEdit}><Pencil />Edit item</Button>{item.instagram_url && <Button asChild variant="outline"><a href={item.instagram_url} target="_blank" rel="noopener noreferrer"><Instagram />View post<ExternalLink className="size-3" /></a></Button>}</div>
          {item.description && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{item.description}</p>}
          <section className="space-y-3"><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">Caption & hashtags</h3>{item.caption && <Button size="sm" variant="ghost" onClick={copyCaption}>{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy"}</Button>}</div>{item.caption ? <p className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-xl bg-muted/60 p-4 text-sm leading-relaxed selection:bg-orange-200 selection:text-black">{item.caption}</p> : <p className="text-sm text-muted-foreground">No caption yet. Add one in Edit item.</p>}</section>
          {!!item.assets.length && <section className="space-y-3"><h3 className="text-sm font-semibold">Downloads</h3><div className="max-h-56 space-y-1 overflow-y-auto">{item.assets.map(asset => asset.url ? <a key={asset.id} href={downloadUrl(asset)} target="_blank" rel="noopener noreferrer" download={asset.filename} className="flex min-w-0 items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted"><Download className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1"><span className="block truncate text-sm" title={asset.filename}>{asset.filename}</span><span className="text-xs text-muted-foreground">{fileSize(asset.size)}{asset.role === "cover" ? " · Cover" : ""}</span></span></a> : <p key={asset.id} className="break-words px-2 text-xs text-muted-foreground">{asset.filename} — preview unavailable</p>)}</div></section>}
          {error && <p role="alert" className="rounded-lg bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
          <div className="border-t pt-4">{confirmArchive ? <div className="space-y-3 rounded-lg bg-muted p-3"><p className="text-sm">Archive this item? It will leave this library. Its project files and Instagram post will stay as they are.</p><div className="flex gap-2"><Button size="sm" variant="destructive" disabled={busy} onClick={archive}>{busy ? "Archiving…" : "Archive item"}</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmArchive(false)}>Keep item</Button></div></div> : <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setConfirmArchive(true)}><Archive />Archive item</Button>}</div>
        </div>
      </div>
    </DialogContent>
  </Dialog>;
}
