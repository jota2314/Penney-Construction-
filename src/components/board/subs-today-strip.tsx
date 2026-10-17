"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, HardHat, MessageSquare, RefreshCw, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { getSubsToday } from "@/lib/actions/sub-activity";
import { etTimeLabel } from "@/lib/sub-portal/et-day";
import type { SubsToday, SubTodayRow } from "@/lib/subs/sub-digest";
import { SubsNeededSheet } from "./subs-needed-sheet";

/**
 * "Subs today" on the Job Board (plan §4.1): who checked in, posted or
 * clocked in on which job today, and who was scheduled and never showed.
 *
 *   MGL Tile Inc (Marcio) · Pedersen · since 7:12 AM · 2 posts · 14 photos
 *   Northeast Kitchens · scheduled at Weidlein · no check-in   [Text]
 *   …after 3 PM ET: On site, no post yet                         [Text]
 *   Not on the schedule: assign?   → Subs needed, filtered to that job
 *
 * Text opens the PM's own Messages with "Marcio, add today's Pedersen
 * photos: …?job=…" (no SMS service; hidden when the sub has no cell on
 * file). Fetches itself, so the board's server load doesn't grow, and
 * refreshes when the tab comes back after a couple of minutes. Renders
 * nothing on a day with no subs.
 */

const OPEN_KEY = "job-board-subs-today-open";
const STALE_MS = 2 * 60 * 1000;
const REFRESH_MS = 5 * 60 * 1000;
const FIRST_ROWS = 6;

function readOpen(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(OPEN_KEY) !== "0";
  } catch {
    return true;
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function SubsTodayStrip({
  onOpenProject,
  className,
}: {
  /** Opens the board's project drawer. */
  onOpenProject?: (projectId: string) => void;
  className?: string;
}) {
  const router = useRouter();
  const [data, setData] = useState<SubsToday | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Safe as a lazy initial value: nothing renders until the first fetch lands.
  const [open, setOpen] = useState<boolean>(readOpen);
  const [showAll, setShowAll] = useState(false);
  /** The job whose Subs needed sheet is open. */
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const loadedAt = useRef(0);
  const inflight = useRef(false);

  const load = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const res = await getSubsToday();
      if (res.ok) {
        setData(res.data);
        setError(null);
        loadedAt.current = Date.now();
      } else {
        setError(res.error);
      }
    } catch {
      setError("Couldn't load today's subs.");
    } finally {
      inflight.current = false;
      setLoading(false);
    }
  }, []);

  const reload = useCallback(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    void load();
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - loadedAt.current > STALE_MS) void load();
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const toggleOpen = () => {
    setOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(OPEN_KEY, next ? "1" : "0");
      } catch {
        // Private browsing: the choice just won't stick.
      }
      return next;
    });
  };

  const sheet = assignFor ? (
    <SubsNeededSheet
      projectId={assignFor}
      onClose={() => {
        setAssignFor(null);
        // An assignment can put him on the schedule, and adds a bar.
        void load();
        router.refresh();
      }}
    />
  ) : null;

  if (!data) {
    if (!error) return null;
    return (
      <p className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)}>
        <HardHat className="h-3.5 w-3.5" aria-hidden />
        Subs today: {error}
        <button type="button" onClick={reload} className="underline underline-offset-2 hover:text-foreground">
          Retry
        </button>
      </p>
    );
  }
  if (data.rows.length === 0) return sheet;

  const { counts } = data;
  const summary = [
    counts.onSite ? `${counts.onSite} on site` : "nobody on site yet",
    counts.noCheckin ? `${counts.noCheckin} scheduled, no check-in` : null,
    counts.noPostYet ? `${counts.noPostYet} no post yet` : null,
    counts.unscheduled ? `${counts.unscheduled} not on the schedule` : null,
  ].filter(Boolean);
  const rows = showAll ? data.rows : data.rows.slice(0, FIRST_ROWS);
  const hidden = data.rows.length - rows.length;

  return (
    <section aria-label="Subs today" className={cn("rounded-lg border border-border bg-card/40 px-3 py-2 text-xs", className)}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <button
          type="button"
          onClick={toggleOpen}
          aria-expanded={open}
          className="flex items-center gap-1.5 font-medium text-foreground"
        >
          <HardHat className="h-3.5 w-3.5 text-amber-500" aria-hidden />
          Subs today
          {open ? <ChevronUp className="h-3.5 w-3.5" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
        </button>
        <span className="text-muted-foreground">{summary.join(" · ")}</span>
        <button
          type="button"
          onClick={reload}
          disabled={loading}
          className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
          aria-label="Refresh subs today"
          title="Refresh"
        >
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} aria-hidden />
        </button>
      </div>
      {error && <p className="mt-1 text-red-400">{error}</p>}

      {open && (
        <ul className="mt-1.5 space-y-1">
          {rows.map((row) => (
            <SubRow key={row.key} row={row} onOpenProject={onOpenProject} onAssign={() => setAssignFor(row.projectId)} />
          ))}
          {(hidden > 0 || showAll) && data.rows.length > FIRST_ROWS && (
            <li>
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                {showAll ? "Show fewer" : `Show all ${data.rows.length}`}
              </button>
            </li>
          )}
        </ul>
      )}
      {sheet}
    </section>
  );
}

function SubRow({
  row,
  onOpenProject,
  onAssign,
}: {
  row: SubTodayRow;
  onOpenProject?: (projectId: string) => void;
  onAssign: () => void;
}) {
  const job = onOpenProject ? (
    <button
      type="button"
      onClick={() => onOpenProject(row.projectId)}
      title={row.projectName}
      className="underline-offset-2 hover:text-foreground hover:underline"
    >
      {row.jobShort}
    </button>
  ) : (
    <span title={row.projectName}>{row.jobShort}</span>
  );
  const textLink = row.smsHref ? (
    <a
      href={row.smsHref}
      className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 font-medium text-foreground hover:border-primary/50"
      title={`Text ${row.company} from your phone`}
    >
      <MessageSquare className="h-3 w-3" aria-hidden />
      Text
    </a>
  ) : null;
  const sep = <span aria-hidden>·</span>;

  if (row.state === "scheduled_no_checkin") {
    return (
      <li className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground">
        <span className="font-medium text-foreground">{row.label}</span>
        {sep}
        <span>scheduled at</span>
        {job}
        {row.phaseName && (
          <>
            {sep}
            <span className="truncate">{row.phaseName}</span>
          </>
        )}
        {sep}
        <span className="text-amber-500">no check-in</span>
        {textLink}
      </li>
    );
  }

  const since = row.firstSeenAt ? etTimeLabel(row.firstSeenAt) : "";
  return (
    <li className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground">
      <span className="font-medium text-foreground">{row.label}</span>
      {sep}
      {job}
      {since && (
        <>
          {sep}
          <span>since {since}</span>
        </>
      )}
      {row.posts > 0 && (
        <>
          {sep}
          <span>{plural(row.posts, "post")}</span>
        </>
      )}
      {row.photos > 0 && (
        <>
          {sep}
          <span>{plural(row.photos, "photo")}</span>
        </>
      )}
      {row.posts === 0 && !row.noPostYet && (
        <>
          {sep}
          <span>no posts yet</span>
        </>
      )}
      {row.clockedIn && (
        <>
          {sep}
          <span className="text-emerald-500">clocked in</span>
        </>
      )}
      {row.noPostYet && (
        <>
          {sep}
          <span className="text-amber-500">On site, no post yet</span>
          {textLink}
        </>
      )}
      {!row.onSchedule && (
        <button
          type="button"
          onClick={onAssign}
          className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-medium text-amber-600 hover:border-amber-500 dark:text-amber-400"
        >
          <UserPlus className="h-3 w-3" aria-hidden />
          Not on the schedule: assign?
        </button>
      )}
    </li>
  );
}
