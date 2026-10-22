"use client";
/* eslint-disable @next/next/no-img-element -- Signed media and swipe previews stay outside a shared image cache. */

import { useState } from "react";
import { ArrowUpRight, ChevronLeft, ChevronRight, Film, Image as ImageIcon, Instagram, Layers, MoveHorizontal, Play } from "lucide-react";
import { useSwipeCarousel } from "@/hooks/use-swipe-carousel";
import type { MarketingItem } from "@/types/marketing";
import { coverAsset, displayDate, kindLabels, mediaAssets, statusLabels } from "./marketing-utils";

export function MarketingCard({ item, onOpen }: { item: MarketingItem; onOpen: (index: number) => void }) {
  const slides = mediaAssets(item);
  const cover = coverAsset(item);
  const [index, setIndex] = useState(0);
  const [failedUrls, setFailedUrls] = useState<string[]>([]);
  const activeIndex = Math.min(index, Math.max(0, slides.length - 1));
  const carousel = item.kind === "carousel" && slides.length > 1;
  const swipe = useSwipeCarousel({ count: carousel ? slides.length : 0, index: activeIndex, onIndexChange: setIndex });
  const KindIcon = item.kind === "video" ? Film : item.kind === "carousel" ? Layers : ImageIcon;
  const navigationClass = "absolute top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/25 bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/75 focus-visible:outline-2 focus-visible:outline-white disabled:invisible";
  const failed = (url: string) => setFailedUrls(current => current.includes(url) ? current : [...current, url]);
  const fallback = <div className="flex size-full flex-col items-center justify-center gap-4 bg-[radial-gradient(ellipse_at_top,_#41403c,_#18181b)] px-8 text-center"><KindIcon className="size-9 text-white/70" /><p className="text-sm font-medium text-white/80">{item.instagram_url ? "Instagram post" : "Open preview"}</p></div>;

  return <article aria-label={item.title} className="group min-w-0 overflow-hidden rounded-2xl border bg-card text-left shadow-sm transition-shadow hover:shadow-lg">
    {carousel ? <>
      <div role="region" aria-roledescription="carousel" aria-label={item.title + " slides"}
        className="relative aspect-[4/5] overflow-hidden bg-zinc-950" style={{ touchAction: "pan-y" }} {...swipe.handlers}
        onKeyDown={event => {
          if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
            event.preventDefault();
            const next = Math.min(slides.length - 1, Math.max(0, activeIndex + (event.key === "ArrowRight" ? 1 : -1)));
            setIndex(next);
            event.currentTarget.querySelector<HTMLButtonElement>('[data-slide="' + next + '"]')?.focus({ preventScroll: true });
          }
        }}>
        <div className="flex size-full motion-reduce:!transition-none" style={swipe.trackStyle}>
          {slides.map((asset, slide) => <button key={asset.id} type="button" data-slide={slide}
            tabIndex={slide === activeIndex ? 0 : -1} aria-hidden={slide !== activeIndex}
            aria-label={"Open " + item.title + ", slide " + (slide + 1) + " of " + slides.length}
            onClick={() => { if (!swipe.consumeSwipe()) onOpen(slide); }}
            className="relative block h-full w-full shrink-0 select-none focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-primary">
            {asset.url && !failedUrls.includes(asset.url) ? asset.mime_type.startsWith("video/")
              ? <><video src={asset.url} preload={slide === activeIndex ? "metadata" : "none"} muted playsInline className="size-full object-contain" onError={() => failed(asset.url!)} aria-hidden="true" /><Play className="absolute left-1/2 top-1/2 size-10 -translate-x-1/2 -translate-y-1/2 text-white" /></>
              : <img src={asset.url} alt={item.title + " — slide " + (slide + 1)} loading="lazy" decoding="async" draggable={false} onError={() => failed(asset.url!)} className="size-full select-none object-contain" />
              : fallback}
          </button>)}
        </div>
        <span className="pointer-events-none absolute right-3 top-3 rounded-full border border-white/20 bg-black/60 px-2.5 py-1 text-xs font-medium tabular-nums text-white backdrop-blur-sm" aria-live="polite" aria-atomic="true">{activeIndex + 1} / {slides.length}</span>
        <button type="button" className={navigationClass + " left-2"} disabled={activeIndex === 0} aria-label="Previous slide" onClick={() => setIndex(activeIndex - 1)}><ChevronLeft className="size-5" /></button>
        <button type="button" className={navigationClass + " right-2"} disabled={activeIndex === slides.length - 1} aria-label="Next slide" onClick={() => setIndex(activeIndex + 1)}><ChevronRight className="size-5" /></button>
      </div>
      <div className="flex min-h-11 items-center justify-between gap-2 border-b px-3">
        <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground"><MoveHorizontal className="size-3.5" />Swipe to explore</span>
        <div className="flex min-w-0 overflow-x-auto" aria-label="Choose a slide">
          {slides.map((asset, slide) => <button key={asset.id} type="button" aria-label={"Show slide " + (slide + 1)} aria-current={activeIndex === slide ? "true" : undefined} className="flex h-11 w-6 shrink-0 items-center justify-center rounded focus-visible:outline-2 focus-visible:outline-primary" onClick={() => setIndex(slide)}><span className={"h-1.5 rounded-full transition-all motion-reduce:transition-none " + (slide === activeIndex ? "w-4 bg-primary" : "w-1.5 bg-muted-foreground/35")} /></button>)}
        </div>
      </div>
    </> : <button type="button" onClick={() => onOpen(0)} aria-label={"Preview " + item.title} className="relative block aspect-[4/5] w-full overflow-hidden bg-zinc-900 focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-primary">
      {cover?.url && !failedUrls.includes(cover.url) ? cover.mime_type.startsWith("video/")
        ? <video src={cover.url + "#t=0.1"} preload="metadata" muted playsInline className="size-full object-cover" onError={() => failed(cover.url!)} aria-hidden="true" />
        : <img src={cover.url} alt="" loading="lazy" draggable={false} className="size-full object-cover" onError={() => failed(cover.url!)} /> : fallback}
      {item.kind === "video" && <span className="absolute left-1/2 top-1/2 flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/40 bg-black/25 text-white backdrop-blur-sm"><Play className="ml-1 size-6 fill-current" /></span>}
    </button>}
    <button type="button" onClick={() => onOpen(activeIndex)} aria-label={"Open " + item.title} className="block w-full space-y-2 p-4 text-left focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-primary">
      <div className="flex items-start justify-between gap-2"><h2 className="line-clamp-2 text-base font-semibold leading-snug">{item.title}</h2><ArrowUpRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" /></div>
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><KindIcon className="size-3.5" />{kindLabels[item.kind]}{item.kind === "carousel" && slides.length ? " · " + slides.length + " slides" : ""}</span><span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{item.status === "posted" && <Instagram className="size-3" />}{statusLabels[item.status]}</span></div>
      <p className="truncate text-xs text-muted-foreground">{item.project?.name || "General marketing"}</p>
      {item.status === "posted" && item.posted_at && <p className="pt-1 text-[11px] text-muted-foreground">Posted {displayDate(item.posted_at)}</p>}
    </button>
  </article>;
}
