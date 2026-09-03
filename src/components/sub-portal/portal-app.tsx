"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Phone } from "lucide-react";
import { AWARDED_STATUSES, LIVE_STATUSES } from "./types";
import type { FieldData, JobRollup, PortalData, Tab } from "./types";
import { BottomNav, DISPLAY, MONO, OFFICE_PHONE, Shell, Skeleton } from "./ui";
import { HomeTab } from "./home-tab";
import { ScheduleTab } from "./schedule-tab";
import { JobsTab } from "./jobs-tab";
import { MoneyTab } from "./money-tab";
import { FieldTab, getLocation, uploadPhotos } from "./field-tab";
import { ClockOutSheet, type ClockOutPayload } from "./clock-out-sheet";
import { workTagsFor } from "./work-tags";

const TAB_KEY = "sub_portal_tab";
const STATUS_RANK: Record<string, number> = { in_progress: 0, on_hold: 1, contracted: 2 };

/**
 * /sub/portal — the signed-in sub's app. Loads both portal payloads once,
 * derives the per-job rollup, and hands it to the five tabs. All data is
 * already scoped to this sub by the API.
 */
export function SubPortalApp() {
  const router = useRouter();
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<FieldData | null>(null);
  // Remember the last tab on this phone — a sub who lives in Field stays
  // there. Safe as a lazy initializer because the page mounts client-only.
  const [tab, setTabState] = useState<Tab>(() => {
    try {
      const saved = window.localStorage.getItem(TAB_KEY) as Tab | null;
      if (saved && ["home", "schedule", "jobs", "money", "field"].includes(saved)) return saved;
    } catch {
      /* storage blocked — start on Home */
    }
    return "home";
  });
  const [openJob, setOpenJob] = useState<string | null>(null);
  const [clockBusy, setClockBusy] = useState(false);
  const [clockOutOpen, setClockOutOpen] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // "What got done" chips — plumbing words for a plumber, electrical for an
  // electrician — from the trades on the sub's directory record.
  const workTags = useMemo(() => workTagsFor(field?.trades ?? []), [field?.trades]);

  const setTab = useCallback((t: Tab) => {
    setTabState(t);
    try {
      window.localStorage.setItem(TAB_KEY, t);
    } catch {
      /* convenience only */
    }
    window.scrollTo({ top: 0 });
  }, []);

  const loadField = useCallback(() => {
    fetch("/api/sub-portal/logs")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && !d.error) setField(d);
      })
      .catch(() => {});
  }, []);

  const loadPortal = useCallback(() => {
    fetch("/api/sub-portal")
      .then((r) => {
        if (r.status === 401) {
          router.replace("/sub");
          return null;
        }
        return r.json();
      })
      .then((d) => {
        if (!d) return;
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch(() => setError("We couldn't load your portal. Try again."));
  }, [router]);

  useEffect(() => {
    loadPortal();
    loadField();
  }, [loadPortal, loadField]);

  // Refresh when the phone comes back to the app — the office may have
  // awarded, scheduled, or paid something since the last look.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        loadPortal();
        loadField();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadPortal, loadField]);

  const flash = useCallback((kind: "ok" | "err", text: string) => {
    setNotice({ kind, text });
    setTimeout(() => setNotice(null), 6000);
  }, []);

  async function clockIn(projectId: string) {
    if (!projectId) return;
    setClockBusy(true);
    const loc = await getLocation();
    const res = await fetch("/api/sub-portal/clock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "in", projectId, loc }),
    });
    const d = await res.json().catch(() => ({}));
    setClockBusy(false);
    if (!res.ok) return flash("err", d.error || "Couldn't clock in. Try again.");
    flash("ok", "You're on the clock.");
    loadField();
  }

  // Clock out opens the sheet (what got done, photos, fix the time); the
  // sheet's submit is the only thing that actually closes the shift.
  function clockOut() {
    if (field?.clock) setClockOutOpen(true);
  }

  async function submitClockOut(p: ClockOutPayload) {
    setClockBusy(true);
    const res = await fetch("/api/sub-portal/clock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "out", tags: p.tags, note: p.note, endedAt: p.endedAt }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setClockBusy(false);
      return flash("err", d.error || "Couldn't clock out. Try again.");
    }
    const failed = d.logId && p.photos.length > 0 ? await uploadPhotos(d.logId, p.photos) : 0;
    setClockBusy(false);
    setClockOutOpen(false);
    const posted = p.tags.length > 0 || p.note || p.photos.length > 0;
    flash(
      failed > 0 ? "err" : "ok",
      failed > 0
        ? `Clocked out — ${d.hours} h, but ${failed} photo(s) didn't upload.`
        : `Clocked out — ${d.hours} h.${posted ? " The office has your update." : " Thanks!"}`,
    );
    loadField();
  }

  async function signOut() {
    await fetch("/api/sub-portal/login", { method: "DELETE" });
    router.replace("/sub");
  }

  // ── Derived ──────────────────────────────────────────────────────────────
  const derived = useMemo(() => {
    if (!data) return null;
    const projectById = new Map(data.projects.map((p) => [p.id, p]));
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = data.phases.filter((p) => !p.end_date || p.end_date >= today);
    const past = data.phases.filter((p) => p.end_date && p.end_date < today);

    const allJobs: JobRollup[] = data.projects.map((proj) => {
      const awarded = data.awarded.filter((a) => a.project_id === proj.id);
      const quotes = data.quotes.filter((q) => q.project_id === proj.id);
      const bids = data.bids.filter((b) => b.project_id === proj.id);
      const rows = (data.billing || []).filter((b) => b.project_id === proj.id);
      // "Do we have a price on this job?" — an awarded line or an accepted
      // quote is a real price; an open quote/bid is a number he's put in
      // that we haven't come back on.
      const agreed =
        awarded.reduce((s, a) => s + (a.amount || 0), 0) +
        quotes.filter((q) => AWARDED_STATUSES.includes(q.status)).reduce((s, q) => s + (q.amount || 0), 0) +
        bids.filter((b) => b.status === "accepted").reduce((s, b) => s + (b.amount || 0), 0);
      const pendingPrice =
        quotes.filter((q) => !AWARDED_STATUSES.includes(q.status) && q.status !== "declined" && q.amount != null).length +
        bids.filter((b) => b.status !== "accepted" && b.status !== "rejected" && b.amount != null).length;
      return {
        proj,
        awarded,
        quotes,
        bids,
        files: data.files.filter((f) => f.project_id === proj.id),
        selections: data.selections.filter((s) => s.project_id === proj.id),
        phases: data.phases.filter((p) => p.project_id === proj.id),
        inspections: (data.inspections || []).filter((i) => i.project_id === proj.id),
        scope: (data.scope || []).filter((s) => s.project_id === proj.id),
        billing: {
          rows,
          billed: rows.reduce((s, b) => s + b.amount, 0),
          paid: rows.reduce((s, b) => s + b.paid, 0),
          open: rows.reduce((s, b) => s + b.open, 0),
        },
        agreed,
        pendingPrice,
        declined: quotes.filter((q) => q.status === "declined").length,
        isLive: LIVE_STATUSES.includes(proj.status),
      };
    });

    // Live list is a WHITELIST: jobs we're building and jobs signed and
    // coming up. Everything else folds under "Past jobs" so a long billing
    // history doesn't bury today's work.
    const jobs = allJobs
      .filter((j) => j.isLive)
      .sort(
        (a, b) =>
          (STATUS_RANK[a.proj.status] ?? 9) - (STATUS_RANK[b.proj.status] ?? 9) ||
          b.agreed - a.agreed ||
          a.proj.project_number.localeCompare(b.proj.project_number),
      );
    const pastJobs = allJobs
      .filter((j) => !j.isLive)
      .sort((a, b) => b.billing.open - a.billing.open || b.proj.project_number.localeCompare(a.proj.project_number));
    const openTotal = allJobs.reduce((s, j) => s + j.billing.open, 0);
    return { projectById, upcoming, past, allJobs, jobs, pastJobs, openTotal };
  }, [data]);

  // The job scheduled for today, if any — the Field tab's default post
  // target when the phone can't place the sub on a job pin.
  const todayJobId = useMemo(() => {
    if (!derived) return null;
    const today = new Date().toISOString().slice(0, 10);
    const phase = derived.upcoming.find(
      (p) => p.start_date && p.start_date <= today && (!p.end_date || p.end_date >= today),
    );
    return phase?.project_id ?? null;
  }, [derived]);

  const openJobFromElsewhere = (projectId: string) => {
    setOpenJob(projectId);
    setTab("jobs");
  };

  const firstName = data?.sub.contact_name?.split(/\s+/)[0] ?? "";

  // ── Render ───────────────────────────────────────────────────────────────
  if (error) {
    return (
      <Shell>
        <p className="mx-auto max-w-sm px-8 pt-24 text-center text-sm text-red-400">{error}</p>
      </Shell>
    );
  }

  return (
    <Shell>
      <header className="border-b border-white/[0.06]">
        <div className="mx-auto max-w-2xl px-5 pb-5 pt-8">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <span className="h-[3px] w-7 bg-amber-500" />
                <p className="text-[10px] uppercase tracking-[0.4em] text-amber-500/90" style={MONO}>
                  Penney Construction
                </p>
              </div>
              {data ? (
                <h1 className="mt-3 text-[1.35rem] font-extrabold uppercase leading-[1.1] text-stone-100 sm:text-[1.7rem]" style={DISPLAY}>
                  {data.sub.company_name}
                </h1>
              ) : (
                <Skeleton className="mt-3 h-8 w-56" />
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <a
                href={`tel:${OFFICE_PHONE}`}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-stone-400 hover:text-stone-200"
                aria-label="Call the office"
              >
                <Phone className="h-4 w-4" />
              </a>
              <button
                onClick={signOut}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-stone-400 hover:text-stone-200"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-5 pb-28 pt-6">
        {!derived ? (
          <div className="space-y-3">
            <Skeleton className="h-20" />
            <div className="grid grid-cols-2 gap-2.5">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
            <Skeleton className="h-28" />
            <Skeleton className="h-40" />
          </div>
        ) : (
          <>
            {tab === "home" && (
              <>
                {notice && (
                  <p
                    className={`mb-4 rounded-xl border px-3.5 py-3 text-[13px] ${
                      notice.kind === "ok"
                        ? "border-emerald-500/40 bg-emerald-500/[0.06] text-emerald-300"
                        : "border-red-500/40 bg-red-500/[0.06] text-red-300"
                    }`}
                  >
                    {notice.text}
                  </p>
                )}
                <HomeTab
                  firstName={firstName}
                  jobs={derived.jobs}
                  allJobs={derived.allJobs}
                  upcoming={derived.upcoming}
                  projectById={derived.projectById}
                  field={field}
                  clockBusy={clockBusy}
                  onClockIn={clockIn}
                  onClockOut={clockOut}
                  onGo={setTab}
                  onOpenJob={openJobFromElsewhere}
                />
              </>
            )}
            {tab === "schedule" && (
              <ScheduleTab upcoming={derived.upcoming} past={derived.past} projectById={derived.projectById} />
            )}
            {tab === "jobs" && (
              <JobsTab jobs={derived.jobs} pastJobs={derived.pastJobs} openJob={openJob} onToggle={setOpenJob} />
            )}
            {tab === "money" && <MoneyTab allJobs={derived.allJobs} onOpenJob={openJobFromElsewhere} />}
            {tab === "field" && (
              <FieldTab
                field={field}
                reload={loadField}
                workTags={workTags}
                todayJobId={todayJobId}
                clockBusy={clockBusy}
                onClockIn={clockIn}
                onClockOut={clockOut}
                notice={notice}
                flash={flash}
              />
            )}
          </>
        )}

        <p className="mt-10 text-center text-[12px] text-stone-600">
          Questions? Call the office at{" "}
          <a href={`tel:${OFFICE_PHONE}`} className="text-stone-400 underline underline-offset-2">
            {OFFICE_PHONE}
          </a>
        </p>
      </main>

      <BottomNav
        tab={tab}
        onChange={setTab}
        badges={{
          money: (derived?.openTotal ?? 0) > 0.5,
          field: !!field?.clock,
        }}
      />

      {clockOutOpen && field?.clock && (
        <ClockOutSheet
          clock={field.clock}
          tags={workTags}
          busy={clockBusy}
          onCancel={() => setClockOutOpen(false)}
          onSubmit={submitClockOut}
        />
      )}
    </Shell>
  );
}
