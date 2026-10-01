"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { formatCurrency } from "@/lib/utils";
import type { ProposalStamp } from "@/lib/estimates/proposal-stamp";

const POLL_MS = 3000;
const FLASH_MS = 4000;
// If a new PDF never fires onLoad (plugin quirk), swap it in anyway.
const SWAP_TIMEOUT_MS = 20000;
const MAX_PAGE = 99;

interface LiveProposalViewProps {
  estimate: { id: string; name: string; version: number };
  project: { id: string; name: string; projectNumber: string };
  initial: ProposalStamp;
  initialPage: number;
}

interface Frame {
  id: number;
  src: string;
}

type Connection = "ok" | "error" | "signed-out";

function pdfSrc(projectId: string, estimateId: string, stamp: string, page: number): string {
  const qs = new URLSearchParams({
    projectId,
    estimateId,
    preview: "1",
    inline: "1",
    v: stamp,
  });
  return `/api/generate-proposal-pdf?${qs.toString()}#page=${page}`;
}

function formatDelta(delta: number): string {
  const abs = Math.abs(delta);
  return `${delta > 0 ? "+" : "−"}${formatCurrency(abs, abs < 1 ? "two" : "zero")}`;
}

// One-second clock for the "updated Xs ago" label. Null during SSR/hydration
// so server and client markup match.
function subscribeClock(onTick: () => void) {
  const t = setInterval(onTick, 1000);
  return () => clearInterval(t);
}
const clockSnapshot = () => Math.floor(Date.now() / 1000);
const clockServerSnapshot = () => null;

function UpdatedAgo({ iso }: { iso: string | null }) {
  const nowSec = useSyncExternalStore(subscribeClock, clockSnapshot, clockServerSnapshot);
  if (!iso || nowSec == null) return null;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  const secs = Math.max(0, nowSec - Math.floor(then / 1000));
  let label: string;
  if (secs < 5) label = "just now";
  else if (secs < 60) label = `${secs}s ago`;
  else if (secs < 3600) label = `${Math.floor(secs / 60)}m ago`;
  else if (secs < 86400) label = `${Math.floor(secs / 3600)}h ago`;
  else label = `${Math.floor(secs / 86400)}d ago`;
  return <> · updated {label}</>;
}

export function LiveProposalView({ estimate, project, initial, initialPage }: LiveProposalViewProps) {
  const [info, setInfo] = useState<ProposalStamp>(initial);
  const [page, setPage] = useState(initialPage);
  // Frames are kept in ascending id order and never reordered: moving an
  // iframe in the DOM reloads it. The newest frame loads hidden behind the
  // shown one and is swapped in on load, so the PDF never flashes blank.
  const [view, setView] = useState<{ frames: Frame[]; shownId: number }>(() => ({
    frames: [{ id: 0, src: pdfSrc(project.id, estimate.id, initial.stamp, initialPage) }],
    shownId: 0,
  }));
  const [connection, setConnection] = useState<Connection>("ok");
  const [flash, setFlash] = useState<{ delta: number; key: number } | null>(null);

  const infoRef = useRef(initial);
  const pageRef = useRef(initialPage);
  const nextFrameId = useRef(1);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const newestId = view.frames[view.frames.length - 1].id;
  const refreshing = newestId !== view.shownId;

  const loadFrame = useCallback(
    (stamp: string, pageNum: number) => {
      const id = nextFrameId.current++;
      const src = pdfSrc(project.id, estimate.id, stamp, pageNum);
      // Keep what's on screen; drop any older frame that's still loading.
      setView((v) => ({
        shownId: v.shownId,
        frames: [...v.frames.filter((f) => f.id === v.shownId), { id, src }],
      }));
    },
    [project.id, estimate.id],
  );

  const handleLoad = useCallback((id: number) => {
    setView((v) => {
      const newest = v.frames[v.frames.length - 1];
      if (id !== newest.id || id === v.shownId) return v;
      return { shownId: id, frames: [newest] };
    });
  }, []);

  // Safety net: never sit on "Refreshing" forever.
  useEffect(() => {
    if (!refreshing) return;
    const t = setTimeout(() => handleLoad(newestId), SWAP_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [refreshing, newestId, handleLoad]);

  const apply = useCallback(
    (next: ProposalStamp) => {
      const prev = infoRef.current;
      if (next.stamp === prev.stamp) return;
      infoRef.current = next;
      setInfo(next);
      loadFrame(next.stamp, pageRef.current);

      const delta = next.total_price - prev.total_price;
      if (Math.abs(delta) >= 0.005) {
        if (flashTimer.current) clearTimeout(flashTimer.current);
        setFlash({ delta, key: Date.now() });
        flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS);
      }
    },
    [loadFrame],
  );

  useEffect(() => {
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  // Poll the change stamp every few seconds; pause while the tab is hidden
  // and check right away when it comes back.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    let inFlight = false;

    const clear = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const schedule = () => {
      clear();
      if (!cancelled && !document.hidden) timer = setTimeout(poll, POLL_MS);
    };

    async function poll() {
      if (cancelled || inFlight || document.hidden) return;
      inFlight = true;
      try {
        const res = await fetch(`/api/estimates/${estimate.id}/stamp`, { cache: "no-store" });
        if (cancelled) return;
        if (res.status === 401) {
          setConnection("signed-out");
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const next = (await res.json()) as ProposalStamp;
        if (cancelled) return;
        setConnection("ok");
        apply(next);
      } catch {
        if (!cancelled) setConnection("error");
      } finally {
        inFlight = false;
        schedule();
      }
    }

    const onVisibility = () => {
      if (document.hidden) clear();
      else void poll();
    };

    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      clear();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [estimate.id, apply]);

  const changePage = (n: number) => {
    const clamped = Math.min(MAX_PAGE, Math.max(1, n));
    if (clamped === pageRef.current) return;
    pageRef.current = clamped;
    setPage(clamped);
    loadFrame(infoRef.current.stamp, clamped);
    // Keep the page in the URL so a browser reload lands on it too.
    try {
      const params = new URLSearchParams(window.location.search);
      params.set("page", String(clamped));
      window.history.replaceState(null, "", `?${params.toString()}`);
    } catch {
      /* non-critical */
    }
  };

  const marginColor =
    info.margin_pct >= 25 ? "text-green-400" : info.margin_pct >= 15 ? "text-amber-400" : "text-red-400";

  const status =
    connection === "signed-out"
      ? { dot: "bg-red-500", ping: false, label: <>Signed out · sign in again</> }
      : connection === "error"
        ? { dot: "bg-red-500", ping: false, label: <>Offline · retrying</> }
        : refreshing
          ? { dot: "bg-amber-400", ping: true, label: <>Live · refreshing…</> }
          : { dot: "bg-green-500", ping: true, label: <>Live<UpdatedAgo iso={info.updated_at} /></> };

  const builderHref = `/projects/${project.id}/estimates/${estimate.id}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b px-3 py-2 text-sm">
        <SidebarTrigger className="-ml-1 hidden md:flex" />

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 font-mono text-xs text-amber-500">{project.projectNumber}</span>
            <span className="truncate font-semibold">{project.name}</span>
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {estimate.name} · v{estimate.version}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`rounded-md px-2 py-0.5 text-lg font-bold tabular-nums transition-colors duration-700 ${
              flash ? "bg-amber-500/25 ring-1 ring-amber-500/60" : "bg-transparent"
            }`}
          >
            {formatCurrency(info.total_price)}
          </span>
          {flash && (
            <span
              key={flash.key}
              className={`text-xs font-semibold tabular-nums ${flash.delta > 0 ? "text-green-400" : "text-red-400"}`}
            >
              {formatDelta(flash.delta)}
            </span>
          )}
          <span className={`font-semibold tabular-nums ${marginColor}`}>
            {info.margin_pct.toFixed(1)}% margin
          </span>
        </div>

        <span className="inline-flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
          <span className="relative flex h-2 w-2">
            {status.ping && (
              <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${status.dot}`} />
            )}
            <span className={`relative inline-flex h-2 w-2 rounded-full ${status.dot}`} />
          </span>
          {status.label}
        </span>

        <div className="flex items-center gap-1">
          <span className="mr-1 text-xs text-muted-foreground">Page</span>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => changePage(page - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="w-6 text-center font-semibold tabular-nums">{page}</span>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Next page"
            disabled={page >= MAX_PAGE}
            onClick={() => changePage(page + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <Button asChild variant="outline" size="sm">
          <Link href={builderHref}>
            <ArrowLeft className="h-4 w-4" />
            Estimate
          </Link>
        </Button>
      </header>

      <div className="relative min-h-0 flex-1 bg-muted/30">
        {view.frames.map((f) => (
          <iframe
            key={f.id}
            src={f.src}
            title="Client proposal"
            onLoad={() => handleLoad(f.id)}
            className={`absolute inset-0 h-full w-full border-0 ${
              f.id === view.shownId ? "z-10" : "pointer-events-none z-0 opacity-0"
            }`}
          />
        ))}
        {info.line_count === 0 && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/90 p-6 text-center text-sm text-muted-foreground">
            No estimate lines yet. The proposal will appear here as soon as lines are added.
          </div>
        )}
      </div>
    </div>
  );
}
