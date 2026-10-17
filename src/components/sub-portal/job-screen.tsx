"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Empty, PortalNotice } from "@/components/portal-kit";
import { fmtTime, telHref } from "@/lib/portal-kit/format";
import type { SubJobHeader, SubJobPayload, SubPost, SubPostsPage } from "@/lib/sub-portal/payload";
import { JobDrawings } from "./job-drawings";
import { JobInfo } from "./job-info";
import { JobLog } from "./job-log";
import { SUB_OUTBOX_SENT_EVENT, useSubOutbox } from "./post-outbox";

/**
 * One job, one screen (plan §2.3 S3): posting, drawings, scope, dates and
 * that job's money together. The header (back, name, address + Directions,
 * his Penney contact + Call, "✓ Checked in" when he's here today), then
 * Log | Drawings | Job info, opening on Log. The QR landing (?compose=1)
 * opens Log with the composer in view.
 *
 * Loaded when he opens it: GET /api/sub-portal/job/{id} with his cookie, or
 * in the staff preview GET /api/sub-portal/preview-data?subId=…&job=… (read
 * only, no cookie, no view bump). In the preview every button is off.
 */

const OFFICE_PHONE = "978-621-4387";
/** Coming back to the app refetches only when the page is older than this. */
const STALE_MS = 2 * 60_000;

/** The job screen's segments. */
export type JobView = "log" | "drawings" | "info";
type Segment = JobView;
const SEGMENTS: { key: Segment; label: string }[] = [
  { key: "log", label: "Log" },
  { key: "drawings", label: "Drawings" },
  { key: "info", label: "Job info" },
];

function jobUrl(projectId: string, previewSubId: string | null, cursor: string | null): string {
  const params = new URLSearchParams();
  let base: string;
  if (previewSubId) {
    base = "/api/sub-portal/preview-data";
    params.set("subId", previewSubId);
    params.set("job", projectId);
  } else {
    base = `/api/sub-portal/job/${encodeURIComponent(projectId)}`;
  }
  if (cursor) params.set("cursor", cursor);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/** The posts page from a cursor fetch (the full job payload, or just its page). */
function postsPageOf(body: unknown): SubPostsPage | null {
  const b = body as { posts?: SubPostsPage; items?: SubPost[]; next_cursor?: string | null } | null;
  if (b?.posts && Array.isArray(b.posts.items)) return b.posts;
  if (b && Array.isArray(b.items)) return { items: b.items, next_cursor: b.next_cursor ?? null };
  return null;
}

function errorText(status: number, body: unknown): string {
  const msg = (body as { error?: unknown } | null)?.error;
  if (typeof msg === "string" && msg.trim()) return msg;
  if (status === 403 || status === 404) return "This job isn't on your list any more.";
  return "We couldn't load this job. Try again.";
}

const STATUS_PILL: Record<string, { label: string; color: string }> = {
  contracted: { label: "Starting soon", color: "#252D2B" },
  on_hold: { label: "On hold", color: "#7A5A1E" },
};

export function JobScreen({
  projectId,
  previewSubId,
  compose = false,
  initialView = "log",
  onBack,
  onChanged,
  jobsForInvoice,
  billsEnabled = false,
  agreementsEnabled,
  officePhone = OFFICE_PHONE,
}: {
  projectId: string;
  /** Set in the staff preview: fetch through preview-data and save nothing. */
  previewSubId: string | null;
  /** The QR landing (?compose=1): open Log with the composer in view. */
  compose?: boolean;
  /** Open on another segment (Money's "By job" rows open Job info). compose wins. */
  initialView?: JobView;
  onBack: () => void;
  /** Something saved here (post, inspection, clock, signature): refresh the home payload. */
  onChanged?: () => void;
  /** Every job he may bill (live jobs, then jobs he's owed on), for the invoice sheet's job picker. */
  jobsForInvoice?: { project_id: string; name: string }[];
  /** flags.bills_enabled: shows "Send an invoice for this job" in Job info. Off unless passed. */
  billsEnabled?: boolean;
  /** flags.agreements_enabled; left out = agreement.can_sign alone decides. */
  agreementsEnabled?: boolean;
  /** flags.office_phone, the Call fallback when the job has no PM phone. */
  officePhone?: string;
}) {
  const [data, setData] = useState<SubJobPayload | null>(null);
  const [posts, setPosts] = useState<SubPost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [segment, setSegment] = useState<Segment>(compose ? "log" : initialView);
  // The compose landing focuses the composer once; switching tabs drops it.
  const [focusComposer, setFocusComposer] = useState(compose);
  const seq = useRef(0);
  const loadedAt = useRef(0);

  // The current job only: a stale response for another job never shows.
  const current = data && data.job.project_id === projectId ? data : null;
  const preview = previewSubId != null || current?.mode === "preview";

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const res = await fetch(jobUrl(projectId, previewSubId, null), { credentials: "same-origin", cache: "no-store" });
      if (mine !== seq.current) return;
      if (res.status === 401 && !previewSubId) {
        window.location.replace("/sub");
        return;
      }
      const body: unknown = await res.json().catch(() => null);
      if (mine !== seq.current) return;
      const payload = body as SubJobPayload | null;
      if (!res.ok || !payload || (body as { error?: unknown }).error || !payload.job) {
        setError(errorText(res.status, body));
        return;
      }
      loadedAt.current = Date.now();
      setData(payload);
      setPosts(payload.posts?.items ?? []);
      setCursor(payload.posts?.next_cursor ?? null);
      setError(null);
    } catch {
      if (mine === seq.current) setError("No connection. Check your signal and try again.");
    }
  }, [projectId, previewSubId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Open at the top (the QR landing scrolls to the composer instead).
  useEffect(() => {
    if (!compose) window.scrollTo({ top: 0 });
  }, [projectId, compose]);

  // Back in the app after a while: the office may have posted drawings or booked dates.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - loadedAt.current > STALE_MS) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  // A post saved on the phone without signal reached the server: show it.
  useEffect(() => {
    const onSent = () => void load();
    window.addEventListener(SUB_OUTBOX_SENT_EVENT, onSent);
    return () => window.removeEventListener(SUB_OUTBOX_SENT_EVENT, onSent);
  }, [load]);

  // When the last queued photo lands, reload so the post shows all of them.
  // (The outbox's `pending` already includes what's sending.)
  const outstanding = useSubOutbox().pending;
  const lastOutstanding = useRef(outstanding);
  useEffect(() => {
    if (lastOutstanding.current > 0 && outstanding === 0) void load();
    lastOutstanding.current = outstanding;
  }, [outstanding, load]);

  const refresh = useCallback(() => {
    void load();
    onChanged?.();
  }, [load, onChanged]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(jobUrl(projectId, previewSubId, cursor), { credentials: "same-origin", cache: "no-store" });
      const body: unknown = await res.json().catch(() => null);
      const page = res.ok ? postsPageOf(body) : null;
      if (!page) {
        setError(errorText(res.status, body));
        return;
      }
      setPosts((ps) => {
        const seen = new Set(ps.map((p) => p.id));
        return [...ps, ...page.items.filter((p) => !seen.has(p.id))];
      });
      setCursor(page.next_cursor);
    } catch {
      setError("No connection. Check your signal and try again.");
    } finally {
      setLoadingMore(false);
    }
  }

  const pick = (key: Segment) => {
    if (key !== "log") setFocusComposer(false);
    setSegment(key);
  };

  // Rendered in place of the tabs, so it brings its own page column.
  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 pt-3" style={{ paddingBottom: "max(48px, env(safe-area-inset-bottom))" }}>
      <button type="button" onClick={onBack} className="inline-flex min-h-[44px] items-center gap-1.5 pr-3 text-[16px] font-bold">
        <span aria-hidden className="text-[24px] leading-none">‹</span>
        Your jobs
      </button>

      {!current ? (
        error ? (
          <Empty
            action={
              <button type="button" onClick={() => void load()} className="btn btn-primary">
                Try again
              </button>
            }
          >
            {error}
          </Empty>
        ) : (
          <div className="card p-6 text-center text-[16px] text-[var(--muted)]" role="status">
            Loading the job…
          </div>
        )
      ) : (
        <>
          <JobHeaderCard job={current.job} officePhone={officePhone} />
          {error && <PortalNotice notice={{ tone: "error", text: error }} onDismiss={() => setError(null)} />}

          <div role="tablist" aria-label="Job sections" className="flex gap-3">
            {SEGMENTS.map((s) => {
              const on = s.key === segment;
              return (
                <button
                  key={s.key}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => pick(s.key)}
                  className="min-h-[44px] flex-1 rounded-full border px-2 text-[16px] font-bold"
                  style={
                    on
                      ? { background: "var(--ink)", borderColor: "var(--ink)", color: "#fff" }
                      : { background: "#fff", borderColor: "var(--line)", color: "var(--ink)" }
                  }
                >
                  {s.label}
                </button>
              );
            })}
          </div>

          {/* Always mounted: the composer's picked photos, chips, note and retry id
              live in its state, and switching segments must never drop them. */}
          <div hidden={segment !== "log"}>
            <JobLog
              data={current}
              posts={posts}
              nextCursor={cursor}
              loadingMore={loadingMore}
              onLoadMore={() => void loadMore()}
              preview={preview}
              compose={focusComposer}
              onChanged={refresh}
            />
          </div>
          {segment === "drawings" && <JobDrawings files={current.files} />}
          {segment === "info" && (
            <JobInfo
              data={current}
              preview={preview}
              agreementsEnabled={agreementsEnabled}
              jobsForInvoice={billsEnabled ? jobsForInvoice : undefined}
              onChanged={refresh}
            />
          )}
        </>
      )}
    </main>
  );
}

function JobHeaderCard({ job, officePhone }: { job: SubJobHeader; officePhone: string }) {
  const pmName = job.pm?.first_name || job.pm?.name || null;
  const phone = job.pm?.phone || officePhone;
  // Building is the normal case; only flag the odd ones out.
  const status = job.status !== "in_progress" ? STATUS_PILL[job.status] : undefined;
  return (
    <section className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="min-w-0 text-[22px] font-extrabold leading-tight">{job.name}</h2>
        {status && (
          <span className="shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[13px] font-bold text-white" style={{ background: status.color }}>
            {status.label}
          </span>
        )}
      </div>
      {/* Only his own QR scan today says he's here; a post or clock-in doesn't. */}
      {job.visit_today && job.visit_today.scans > 0 && (
        <p className="mt-2 inline-flex items-center rounded-full px-3 py-1 text-[15px] font-bold text-white" style={{ background: "#2F6B4F" }}>
          ✓ Checked in {fmtTime(job.visit_today.first_seen_at)}
        </p>
      )}
      {job.address && (
        <div className="mt-3 flex items-center gap-3">
          <p className="min-w-0 flex-1 text-[16px] text-[var(--muted)]">{job.address}</p>
          {job.directions_url && (
            <a href={job.directions_url} target="_blank" rel="noreferrer" className="btn btn-ghost shrink-0">
              Directions
            </a>
          )}
        </div>
      )}
      <div className="mt-3 flex items-center gap-3 border-t border-[var(--line)] pt-3">
        <p className="min-w-0 flex-1 text-[16px]">
          {pmName ? (
            <>
              Your Penney contact: <span className="font-bold">{pmName}</span>
            </>
          ) : (
            "Questions? Call the office."
          )}
        </p>
        <a href={telHref(phone)} aria-label={`Call ${pmName ?? "the office"}`} className="btn btn-ghost shrink-0">
          Call
        </a>
      </div>
    </section>
  );
}
