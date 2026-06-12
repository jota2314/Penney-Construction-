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

function fmtRange(start: string, end: string): string {
  const fmt = (d: string) =>
    new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return start === end ? fmt(start) : `${fmt(start)} → ${fmt(end)}`;
}

export function JobClockInSheet({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [jobs, setJobs] = useState<ClockInJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);

  const [job, setJob] = useState<ClockInJob | null>(null);
  const [phases, setPhases] = useState<JobPhaseOption[]>([]);
  const [loadingPhases, setLoadingPhases] = useState(false);

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [here, setHere] = useState<Coords | null>(null);
  const reqId = useRef(0);

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
    setLoadingPhases(true);
    startTransition(async () => {
      const rows = await getJobPhases(j.id);
      setPhases(rows);
      setLoadingPhases(false);
    });
  };

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
        style={{ background: v("card"), border: `1px solid ${v("line")}`, color: v("ink") }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${v("line")}` }}>
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase" style={{ color: v("quiet"), letterSpacing: "0.18em" }}>
              {job ? "Pick your task" : "Clock in"}
            </div>
            <div className="text-[15px] font-semibold leading-tight mt-0.5 truncate" style={{ color: v("ink") }}>
              {job ? job.name : "Find a job"}
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
                  autoFocus
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

        {/* Step 2 — pick the line-item task */}
        {job && (
          <>
            <div className="px-5 pt-3 pb-1">
              <button
                onClick={() => {
                  setJob(null);
                  setPhases([]);
                  setError(null);
                }}
                className="text-[12px] font-medium inline-flex items-center gap-1"
                style={{ color: v("accent") }}
              >
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                  <path d="M12 5l-5 5 5 5" />
                </svg>
                All jobs
              </button>
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
    </div>
  );
}
