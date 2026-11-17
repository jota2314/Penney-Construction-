"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, ClipboardList, FileText, FolderOpen, MapPin, NotebookPen, Phone } from "lucide-react";
import { Empty, PortalNotice } from "@/components/portal-kit";
import { projectTypeLabel } from "@/lib/constants/project";
import type { JobView } from "@/lib/sub-portal/job-link";
import { fmtTime, telHref } from "@/lib/portal-kit/format";
import type { SubJobHeader, SubJobPayload, SubPost, SubPostsPage } from "@/lib/sub-portal/payload";
import { JobDrawings } from "./job-drawings";
import { JobBrief } from "./job-brief";
import { JobPaperwork } from "./job-info";
import { JobLog } from "./job-log";
import { SUB_OUTBOX_SENT_EVENT, useSubOutbox } from "./post-outbox";

/**
 * One job, one screen (plan §2.3 S3): posting, drawings, scope, dates and
 * that job's money together. The header (back, name, address + Directions,
 * his Penney contact + Call, "✓ Checked in" when he's here today), then
 * Job brief | Plans & files | Field log | Paperwork. The QR landing (?compose=1)
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
type Segment = JobView;
const SEGMENTS = [
  { key: "info", label: "Job brief", short: "Brief", icon: ClipboardList },
  { key: "drawings", label: "Plans & files", short: "Files", icon: FolderOpen },
  { key: "log", label: "Field log", short: "Log", icon: NotebookPen },
  { key: "paperwork", label: "Paperwork", short: "Paperwork", icon: FileText },
] as const;

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
  if (cursor) {
    params.set("cursor", cursor);
    params.set("part", "posts");
  }
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
  in_progress: { label: "In progress", color: "#2F6B4F" },
  audit: { label: "Closing out", color: "#5F6763" },
  completed: { label: "Completed", color: "#5F6763" },
  cancelled: { label: "Cancelled", color: "#5F6763" },
};

export function JobScreen({
  projectId,
  previewSubId,
  compose = false,
  initialView = "info",
  onBack,
  onChanged,
  onViewChange,
  onAnswerDates,
  jobsForInvoice,
  billsEnabled = false,
  showMoney,
  agreementsEnabled,
  officePhone = OFFICE_PHONE,
}: {
  projectId: string;
  /** Set in the staff preview: fetch through preview-data and save nothing. */
  previewSubId: string | null;
  /** The QR landing (?compose=1): open Log with the composer in view. */
  compose?: boolean;
  /** Open on another section. compose wins. */
  initialView?: JobView;
  onBack: () => void;
  /** Something saved here (post, inspection, clock, signature): refresh the home payload. */
  onChanged?: () => void;
  onViewChange?: (view: JobView) => void;
  onAnswerDates?: (phaseId: string) => void;
  /** Every job he may bill (live jobs, then jobs he's owed on), for the invoice sheet's job picker. */
  jobsForInvoice?: { project_id: string; name: string }[];
  /** flags.bills_enabled: shows "Send an invoice for this job" in Job info. Off unless passed. */
  billsEnabled?: boolean;
  showMoney: boolean;
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
  const filesButton = useRef<HTMLButtonElement>(null);

  // The current job only: a stale response for another job never shows.
  const current = data && data.job.project_id === projectId ? data : null;
  const preview = previewSubId != null || current?.mode === "preview";
  const showPaperwork = showMoney && current?.billing != null;
  const activeSection = segment === "paperwork" && !showPaperwork ? "info" : segment;
  const sections = SEGMENTS.filter((s) => s.key !== "paperwork" || showPaperwork);

  const handleRefusal = useCallback((status: number, body: unknown) => {
    if (status !== 401 && status !== 403 && status !== 404) return false;
    ++seq.current;
    setData(null);
    setPosts([]);
    setCursor(null);
    setError(errorText(status, body));
    if (status === 401 && !previewSubId) {
      const next = `/sub/portal${window.location.search}${window.location.hash}`;
      window.location.replace(`/sub?next=${encodeURIComponent(next)}`);
    }
    return true;
  }, [previewSubId]);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const res = await fetch(jobUrl(projectId, previewSubId, null), { credentials: "same-origin", cache: "no-store" });
      if (mine !== seq.current) return;
      const body: unknown = await res.json().catch(() => null);
      if (mine !== seq.current) return;
      if (handleRefusal(res.status, body)) return;
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
  }, [projectId, previewSubId, handleRefusal]);

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
    const mine = seq.current;
    setLoadingMore(true);
    try {
      const res = await fetch(jobUrl(projectId, previewSubId, cursor), { credentials: "same-origin", cache: "no-store" });
      const body: unknown = await res.json().catch(() => null);
      if (mine !== seq.current || handleRefusal(res.status, body)) return;
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
      if (mine === seq.current) setError("No connection. Check your signal and try again.");
    } finally {
      setLoadingMore(false);
    }
  }

  const pick = (key: Segment) => {
    if (key !== "log") setFocusComposer(false);
    setSegment(key);
    onViewChange?.(key);
  };

  // Rendered in place of the tabs, so it brings its own page column.
  return (
    <main className="mx-auto w-full max-w-[76rem] px-4 pt-2 [overflow-wrap:anywhere] sm:px-6 sm:pt-4 lg:px-8" style={{ paddingBottom: "max(48px, env(safe-area-inset-bottom))" }}>
      <button type="button" onClick={onBack} className="inline-flex min-h-11 items-center gap-2 pr-4 text-[14px] font-bold text-[var(--muted)] hover:text-[var(--accent-dark)]">
        <ArrowLeft aria-hidden size={16} />
        Back to portal
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

          <div role="group" aria-label="Job sections" className="mb-5 flex border-b border-[var(--line)] sm:mb-7 sm:gap-2">
            {sections.map((s) => {
              const on = s.key === activeSection;
              return (
                <button
                  key={s.key}
                  ref={s.key === "drawings" ? filesButton : undefined}
                  type="button"
                  aria-pressed={on}
                  aria-label={s.label}
                  onClick={() => pick(s.key)}
                  className={`relative -mb-px flex min-h-[52px] min-w-0 flex-1 flex-col items-center justify-center gap-1 border-b-[3px] px-1 py-1.5 text-[13px] font-bold leading-tight min-[430px]:flex-row min-[430px]:gap-2 sm:min-h-14 sm:flex-none sm:px-4 sm:text-[16px] ${on ? "border-[var(--accent)] text-[var(--accent-dark)]" : "border-transparent text-[var(--muted)] hover:text-[var(--ink)]"}`}
                >
                  <s.icon aria-hidden size={17} strokeWidth={1.8} />
                  <span className="sm:hidden">{s.short}</span><span className="hidden sm:inline">{s.label}</span>
                </button>
              );
            })}
          </div>

          {/* Always mounted: the composer's picked photos, chips, note and retry id
              live in its state, and switching segments must never drop them. */}
          <div hidden={activeSection !== "log"} className="mx-auto max-w-3xl">
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
          {activeSection === "info" && (
            <JobBrief
              data={current}
              onAnswerDates={onAnswerDates}
              onFiles={() => {
                pick("drawings");
                filesButton.current?.focus();
              }}
            />
          )}
          {activeSection === "drawings" && <JobDrawings files={current.files} unavailable={current.files_unavailable} onRetry={() => void load()} />}
          {activeSection === "paperwork" && showPaperwork && (
            <JobPaperwork
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
  const status = STATUS_PILL[job.status];
  const identifier = [job.project_number && `Job ${job.project_number}`, projectTypeLabel(job.project_type)].filter(Boolean).join(" · ");
  return (
    <header className="mb-3 grid min-w-0 gap-3 pb-1 pt-2 sm:mb-5 sm:gap-6 sm:pt-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {identifier && <p className="text-[13px] font-extrabold tracking-wide text-[var(--accent-dark)]">{identifier}</p>}
          {status && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-white px-2.5 py-1 text-[12px] font-bold leading-none">
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: status.color }} />
              {status.label}
            </span>
          )}
          {job.visit_today && job.visit_today.scans > 0 && (
            <span className="text-[13px] font-bold text-[#2F6B4F]">✓ Checked in {fmtTime(job.visit_today.first_seen_at)}</span>
          )}
        </div>
        <h1 className="mt-2.5 text-[clamp(1.85rem,4vw,3.35rem)] font-extrabold leading-[1.06] tracking-[-0.045em]">{job.name}</h1>
        {job.address && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3">
            <span className="inline-flex min-w-0 items-center gap-1.5 text-[15px] text-[var(--muted)] sm:text-[16px]">
              <MapPin aria-hidden size={16} className="shrink-0" />{job.address}
            </span>
            {job.directions_url && (
              <a href={job.directions_url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 text-[14px] font-bold text-[var(--accent-dark)] underline underline-offset-4">
                Directions <ArrowUpRight aria-hidden size={14} />
              </a>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--line)] pt-2 md:flex-col md:items-start md:gap-1 md:border-l md:border-t-0 md:py-1 md:pl-6">
        <p className="text-[13px] font-bold text-[var(--muted)]">Penney contact</p>
        {pmName && <p className="font-extrabold md:text-[19px]">{pmName}</p>}
        <a href={telHref(phone)} aria-label={`Call ${job.pm?.phone ? pmName || "your project manager" : "the office"}`} className="ml-auto inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-3 text-[14px] font-bold hover:border-[var(--accent)] md:ml-0 md:mt-1">
          <Phone aria-hidden size={15} />{job.pm?.phone ? "Call PM" : "Call office"}
        </a>
      </div>
    </header>
  );
}
