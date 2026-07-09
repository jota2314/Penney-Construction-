"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { v } from "./tokens";
import {
  searchActiveJobs,
  getJobPhases,
  clockInOnPhase,
  clockInGeneral,
  type ClockInJob,
  type JobPhaseOption,
  type ClockInResult,
} from "@/lib/actions/daily-logs";
import { getCurrentPosition, type Coords } from "@/lib/geo/current-position";
import { distanceMeters, formatDistance, GEOFENCE_METERS } from "@/lib/crew/geo";
import { getCrewJobDocuments, type CrewDoc } from "@/lib/actions/project-files";
import { DailyLogComposer } from "@/components/schedule/daily-log-composer";

const DOC_CAT_LABEL: Record<string, string> = {
  construction_drawings: "Drawings",
  plans: "Plans",
  permits: "Permits",
  specs: "Specs",
  other: "Other",
};
const DOC_CAT_ORDER = ["construction_drawings", "plans", "permits", "specs", "other"];

function jobMapsHref(j: ClockInJob): string {
  const parts = [j.address, j.city, j.state].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(parts)}`;
}

function fmtRange(start: string, end: string): string {
  const fmt = (d: string) =>
    new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return start === end ? fmt(start) : `${fmt(start)} → ${fmt(end)}`;
}

export function JobClockInSheet({
  onClose,
  intent = "clock",
}: {
  onClose: () => void;
  /**
   * "clock" — the classic find-a-job flow (documents, directions, clock in).
   * "update" — post a daily update: picking a job jumps straight into the
   * photo/voice composer. No schedule, no clock required.
   */
  intent?: "clock" | "update";
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [jobs, setJobs] = useState<ClockInJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);

  const [job, setJob] = useState<ClockInJob | null>(null);
  const [mode, setMode] = useState<"folder" | "tasks">("folder");
  const [composeOpen, setComposeOpen] = useState(false);
  const [phases, setPhases] = useState<JobPhaseOption[]>([]);
  const [loadingPhases, setLoadingPhases] = useState(false);
  const [docs, setDocs] = useState<CrewDoc[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [here, setHere] = useState<Coords | null>(null);
  // Keyboard-aware sizing: lift the sheet above the on-screen keyboard and cap
  // its height to the visible area so the job list never hides behind the keys.
  const [kbHeight, setKbHeight] = useState(0);
  const [sheetMaxH, setSheetMaxH] = useState<number | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      setKbHeight(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
      setSheetMaxH(vv.height - 16);
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  // Grab the worker's location once so we can sort jobs by how close they are —
  // the job they're standing at floats to the top.
  useEffect(() => {
    let cancelled = false;
    getCurrentPosition().then((c) => {
      if (!cancelled && c) setHere(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced job search. setState happens inside the timeout callback (not
  // synchronously in the effect body) so we don't trigger cascading renders.
  useEffect(() => {
    if (job) return; // not searching while a job is selected
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      const rows = await searchActiveJobs(query);
      if (id === reqId.current) {
        setJobs(rows);
        setLoadingJobs(false);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [query, job]);

  // Jobs with distance, sorted nearest-first (jobs without a pin sort last).
  const sortedJobs = useMemo(() => {
    const withDist = jobs.map((j) => ({
      job: j,
      dist:
        here && j.latitude != null && j.longitude != null
          ? distanceMeters(here.lat, here.lng, j.latitude, j.longitude)
          : null,
    }));
    withDist.sort((a, b) => {
      if (a.dist == null && b.dist == null) return a.job.name.localeCompare(b.job.name);
      if (a.dist == null) return 1;
      if (b.dist == null) return -1;
      return a.dist - b.dist;
    });
    return withDist;
  }, [jobs, here]);

  const selectJob = (j: ClockInJob) => {
    setJob(j);
    setError(null);
    // Posting an update: skip the folder — go straight to the composer.
    if (intent === "update") {
      setComposeOpen(true);
      return;
    }
    setMode("folder");
    setLoadingPhases(true);
    setLoadingDocs(true);
    startTransition(async () => {
      const [ph, dc] = await Promise.all([getJobPhases(j.id), getCrewJobDocuments(j.id)]);
      setPhases(ph);
      setDocs(dc);
      setLoadingPhases(false);
      setLoadingDocs(false);
    });
  };

  const backToJobs = () => {
    setJob(null);
    setMode("folder");
    setPhases([]);
    setDocs([]);
    setError(null);
  };

  const docGroups = DOC_CAT_ORDER.map((cat) => ({
    cat,
    label: DOC_CAT_LABEL[cat] ?? cat,
    items: docs.filter((d) => d.category === cat),
  })).filter((g) => g.items.length > 0);

  const clockIn = (action: (loc: Coords | null) => Promise<ClockInResult>) => {
    setError(null);
    startTransition(async () => {
      const loc = await getCurrentPosition();
      const res = await action(loc);
      if (res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
      onClose();
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl flex flex-col max-h-[92vh] overflow-hidden"
        style={{
          background: v("card"),
          border: `1px solid ${v("line")}`,
          color: v("ink"),
          marginBottom: kbHeight,
          maxHeight: sheetMaxH ?? undefined,
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${v("line")}` }}>
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase" style={{ color: v("quiet"), letterSpacing: "0.18em" }}>
              {job ? job.project_number || "Job" : intent === "update" ? "Post update" : "Jobs"}
            </div>
            <div className="text-[15px] font-semibold leading-tight mt-0.5 truncate" style={{ color: v("ink") }}>
              {job ? job.name : intent === "update" ? "Which job are you on?" : "Find a job"}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="opacity-60 hover:opacity-100 flex-shrink-0 ml-3" style={{ color: v("ink") }}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>

        {/* Step 1 — search + pick a job */}
        {!job && (
          <>
            <div className="px-5 pt-4 pb-2">
              <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: v("bg-2"), border: `1px solid ${v("line")}` }}>
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} className="w-4 h-4 flex-shrink-0" style={{ color: v("quiet") }}>
                  <circle cx="9" cy="9" r="6" />
                  <path d="M14 14l3 3" strokeLinecap="round" />
                </svg>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search jobs by name, number, address…"
                  className="flex-1 bg-transparent outline-none text-[14px]"
                  style={{ color: v("ink") }}
                />
              </div>
            </div>
            {here && !loadingJobs && sortedJobs.length > 0 && (
              <div className="px-5 pb-1 text-[10px] font-medium uppercase tracking-[0.16em]" style={{ color: v("quiet") }}>
                Nearest first
              </div>
            )}
            <div className="flex-1 overflow-auto px-3 pb-4 flex flex-col gap-1">
              {loadingJobs ? (
                <div className="px-2 py-6 text-center text-[13px]" style={{ color: v("muted") }}>Searching…</div>
              ) : sortedJobs.length === 0 ? (
                <div className="px-2 py-6 text-center text-[13px]" style={{ color: v("muted") }}>No active jobs found.</div>
              ) : (
                sortedJobs.map(({ job: j, dist }) => {
                  const onSite = dist != null && dist <= GEOFENCE_METERS;
                  return (
                    <button
                      key={j.id}
                      onClick={() => selectJob(j)}
                      className="text-left rounded-lg px-3 py-2 flex items-center gap-3 transition active:scale-[0.99]"
                      style={{
                        background: v("bg-2"),
                        border: `1px solid ${onSite ? "rgba(16,185,129,0.45)" : v("line")}`,
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-[14px] font-semibold leading-tight truncate" style={{ color: v("ink") }}>
                          {j.name}
                        </div>
                        <div className="text-[11px] truncate" style={{ color: v("quiet") }}>
                          {j.project_number}
                          {j.city ? ` · ${j.city}` : ""}
                        </div>
                      </div>
                      {dist != null && (
                        <span
                          className="text-[11px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 inline-flex items-center gap-1"
                          style={
                            onSite
                              ? { background: "rgba(16,185,129,0.16)", color: "#34d399" }
                              : { background: v("bg"), color: v("muted"), border: `1px solid ${v("line")}` }
                          }
                        >
                          {onSite && (
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#10b981" }} />
                          )}
                          {formatDistance(dist)}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </>
        )}

        {/* Step 2 — job folder: documents + Clock In */}
        {job && mode === "folder" && (
          <>
            <div className="px-5 pt-3 pb-1">
              <button
                onClick={backToJobs}
                className="text-[12px] font-medium inline-flex items-center gap-1"
                style={{ color: v("accent") }}
              >
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                  <path d="M12 5l-5 5 5 5" />
                </svg>
                All jobs
              </button>
            </div>

            {(job.address || job.city) && (
              <a
                href={jobMapsHref(job)}
                target="_blank"
                rel="noopener noreferrer"
                className="mx-5 mb-2 rounded-xl px-3 py-2.5 flex items-center gap-2.5 transition active:scale-[0.99]"
                style={{ background: v("bg-2"), border: `1px solid ${v("line")}` }}
              >
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} className="w-4 h-4 flex-shrink-0" style={{ color: v("accent") }}>
                  <path d="M10 3c3 0 5 2 5 5 0 4-5 9-5 9s-5-5-5-9c0-3 2-5 5-5z" />
                  <circle cx="10" cy="8" r="2" />
                </svg>
                <span className="min-w-0 flex-1 text-[13px] truncate" style={{ color: v("ink") }}>
                  {[job.address, job.city, job.state].filter(Boolean).join(", ")}
                </span>
                <span className="text-[11px] font-medium flex-shrink-0" style={{ color: v("accent") }}>Directions</span>
              </a>
            )}

            <div className="px-5 pb-1 text-[10px] font-medium uppercase tracking-[0.16em]" style={{ color: v("quiet") }}>
              Documents
            </div>
            <div className="flex-1 overflow-auto px-3 pb-2 flex flex-col gap-3">
              {loadingDocs ? (
                <div className="px-2 py-8 text-center text-[13px]" style={{ color: v("muted") }}>Loading documents…</div>
              ) : docGroups.length === 0 ? (
                <div className="px-2 py-8 text-center text-[13px]" style={{ color: v("muted") }}>
                  No drawings or documents on this job yet.
                </div>
              ) : (
                docGroups.map((g) => (
                  <div key={g.cat} className="flex flex-col gap-1">
                    <div className="px-2 text-[10px] font-medium uppercase tracking-[0.16em]" style={{ color: v("quiet") }}>
                      {g.label}
                    </div>
                    {g.items.map((d) => (
                      <a
                        key={d.id}
                        href={d.url ?? undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`rounded-lg px-3 py-2.5 flex items-center gap-3 transition active:scale-[0.99] ${d.url ? "" : "opacity-50 pointer-events-none"}`}
                        style={{ background: v("bg-2"), border: `1px solid ${v("line")}` }}
                      >
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-5 h-5 flex-shrink-0" style={{ color: v("accent") }}>
                          <path d="M5 3h7l4 4v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
                          <path d="M12 3v4h4" />
                        </svg>
                        <span className="text-[14px] leading-snug min-w-0 flex-1 truncate" style={{ color: v("ink") }}>
                          {d.filename}
                        </span>
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} className="w-4 h-4 flex-shrink-0" style={{ color: v("quiet") }}>
                          <path d="M7 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </a>
                    ))}
                  </div>
                ))
              )}
            </div>

            <div className="px-5 py-3 flex flex-col gap-2" style={{ borderTop: `1px solid ${v("line")}` }}>
              <button
                onClick={() => setComposeOpen(true)}
                className="w-full py-3.5 rounded-xl flex items-center justify-center gap-2 text-[15px] font-semibold transition active:scale-[0.98]"
                style={{ background: v("bg-2"), color: v("ink"), border: `1px solid ${v("line")}` }}
              >
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" style={{ color: v("accent") }}>
                  <path d="M4 6h3l1.5-2h3L13 6h3a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z" />
                  <circle cx="10" cy="11" r="2.5" />
                </svg>
                Post update — photos + notes
              </button>
              <button
                onClick={() => setMode("tasks")}
                className="w-full py-3.5 rounded-xl flex items-center justify-center gap-2 text-[15px] font-semibold transition active:scale-[0.98]"
                style={{ background: v("accent"), color: "#1a0f00" }}
              >
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                  <circle cx="10" cy="10" r="7" />
                  <path d="M10 6v4l2.5 2" />
                </svg>
                Clock in
              </button>
            </div>
          </>
        )}

        {/* Step 3 — pick the task to clock into */}
        {job && mode === "tasks" && (
          <>
            <div className="px-5 pt-3 pb-1">
              <button
                onClick={() => {
                  setMode("folder");
                  setError(null);
                }}
                className="text-[12px] font-medium inline-flex items-center gap-1 max-w-full"
                style={{ color: v("accent") }}
              >
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 flex-shrink-0">
                  <path d="M12 5l-5 5 5 5" />
                </svg>
                <span className="truncate">{job.name}</span>
              </button>
            </div>
            <div className="px-5 pb-1 text-[10px] font-medium uppercase tracking-[0.16em]" style={{ color: v("quiet") }}>
              Clock in on a task
            </div>

            <div className="flex-1 overflow-auto px-3 pb-2 flex flex-col gap-1.5">
              {loadingPhases ? (
                <div className="px-2 py-6 text-center text-[13px]" style={{ color: v("muted") }}>Loading tasks…</div>
              ) : (
                <>
                  {phases.map((p) => (
                    <button
                      key={p.id}
                      disabled={pending}
                      onClick={() => clockIn((loc) => clockInOnPhase(p.id, loc))}
                      className="text-left rounded-xl px-3 py-2.5 transition active:scale-[0.99] disabled:opacity-50"
                      style={{
                        background: v("bg-2"),
                        border: `1px solid ${p.is_today ? "rgba(16, 185, 129, 0.4)" : v("line")}`,
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[15px] font-semibold leading-tight" style={{ color: v("ink") }}>{p.name}</div>
                        {p.is_today && (
                          <span
                            className="text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded flex-shrink-0"
                            style={{ background: "rgba(16, 185, 129, 0.14)", color: "#34d399", letterSpacing: "0.12em" }}
                          >
                            Today
                          </span>
                        )}
                      </div>
                      {p.line_item_description && (
                        <div className="text-[12px] leading-snug mt-0.5" style={{ color: v("muted") }}>
                          {p.line_item_description}
                        </div>
                      )}
                      <div className="text-[11px] font-mono mt-0.5" style={{ color: v("quiet") }}>
                        {fmtRange(p.start_date, p.end_date)}
                      </div>
                    </button>
                  ))}

                  {phases.length === 0 && (
                    <div className="px-2 py-4 text-center text-[13px]" style={{ color: v("muted") }}>
                      No tasks scheduled on this job yet.
                    </div>
                  )}

                  {/* Fallback — clock in without a scheduled line item. */}
                  <button
                    disabled={pending}
                    onClick={() => clockIn((loc) => clockInGeneral(job.id, loc))}
                    className="text-left rounded-xl px-3 py-2.5 transition active:scale-[0.99] disabled:opacity-50 mt-1"
                    style={{ background: "transparent", border: `1px dashed ${v("line")}` }}
                  >
                    <div className="text-[14px] font-semibold" style={{ color: v("ink") }}>General work</div>
                    <div className="text-[12px]" style={{ color: v("muted") }}>
                      Not one of the scheduled tasks — clock in on this job generally.
                    </div>
                  </button>
                </>
              )}
            </div>
            {error && (
              <div className="mx-5 mb-3 text-[13px] px-3 py-2 rounded-lg" style={{ background: "rgba(239, 68, 68, 0.14)", color: "#fca5a5", border: "1px solid rgba(239, 68, 68, 0.3)" }}>
                {error}
              </div>
            )}
            {pending && (
              <div className="px-5 pb-4 text-[12px]" style={{ color: v("muted") }}>Clocking in…</div>
            )}
          </>
        )}
      </div>

      {/* Photo/voice composer — posts a daily update against the job itself,
          no schedule phase or clock-in required. */}
      {job && composeOpen && (
        <DailyLogComposer
          open={composeOpen}
          onOpenChange={(next) => {
            setComposeOpen(next);
            if (!next) {
              // Posted or cancelled: in update mode the sheet's job is done.
              if (intent === "update") onClose();
            }
          }}
          projectId={job.id}
          projectName={job.name}
        />
      )}
    </div>
  );
}
