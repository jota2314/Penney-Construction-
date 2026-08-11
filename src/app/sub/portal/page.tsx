"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { compressImage } from "@/lib/image/compress";

const DISPLAY = { fontFamily: "var(--font-archivo), sans-serif" } as const;
const MONO = { fontFamily: "var(--font-plex-mono), monospace" } as const;

const OFFICE_PHONE = "978-621-4387";

const fmt = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
const fmtDate = (d: string | null) =>
  d
    ? new Date(d + (d.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    : "TBD";

interface Project { id: string; name: string; project_number: string; address: string; status: string }
interface Phase { id: string; project_id: string; name: string; description: string | null; start_date: string | null; end_date: string | null; status: string }
interface Quote { id: string; project_id: string | null; project_name: string | null; trade: string | null; scope: string | null; amount: number | null; status: string; pdf_url: string | null }
interface Bid { id: string; project_id: string | null; package_name: string | null; trade: string | null; scope: string | null; amount: number | null; status: string; pdf_url: string | null }
interface Awarded { id: string; project_id: string; description: string; scope: string | null; amount: number | null }
interface PortalFile { id: string; project_id: string; filename: string; category: string; url: string }
interface Selection { id: string; project_id: string; category: string; description: string | null; status: string; selected_value: string | null }
interface Inspection { id: string; project_id: string; name: string; status: string; completed_at: string | null; is_final: boolean; notes: string | null }
interface ScopeLine { project_id: string; trade: string; description: string; scope: string | null }
interface PortalData {
  sub: { company_name: string; contact_name: string | null };
  projects: Project[];
  phases: Phase[];
  quotes: Quote[];
  bids: Bid[];
  awarded: Awarded[];
  files: PortalFile[];
  selections: Selection[];
  inspections: Inspection[];
  scope: ScopeLine[];
}

interface FieldJob { id: string; name: string; project_number: string; address: string }
interface FieldLog {
  id: string;
  project_id: string;
  project_name: string;
  author_name: string;
  is_mine: boolean;
  text: string | null;
  status: string;
  started_at: string;
  ended_at: string | null;
  photo_urls: string[];
  photo_thumb_urls: string[];
}
interface FieldClock { logId: string; project_id: string; project_name: string; started_at: string }
interface FieldData { clock: FieldClock | null; jobs: FieldJob[]; logs: FieldLog[] }

const FILE_LABELS: Record<string, string> = {
  construction_drawings: "Drawings",
  specs: "Specs",
  permits: "Permits",
};

// Plain-language job status for subs — where the job stands, no pipeline jargon.
const STATUS_LABELS: Record<string, string> = {
  lead: "Early planning",
  estimating: "Being priced",
  proposal_sent: "Proposal out",
  contracted: "Contract signed",
  in_progress: "In construction",
  on_hold: "On hold",
  completed: "Completed",
};
const statusLabel = (s: string) => STATUS_LABELS[s] || s.replace(/_/g, " ");

type Tab = "schedule" | "jobs" | "field";

export default function SubPortalPage() {
  const router = useRouter();
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("schedule");
  const [openJob, setOpenJob] = useState<string | null>(null);
  const [field, setField] = useState<FieldData | null>(null);

  const loadField = useCallback(() => {
    fetch("/api/sub-portal/logs")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && !d.error) setField(d);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadField();
  }, [loadField]);

  useEffect(() => {
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

  async function signOut() {
    await fetch("/api/sub-portal/login", { method: "DELETE" });
    router.replace("/sub");
  }

  if (error) {
    return (
      <Shell>
        <p className="text-red-400 text-center px-8 max-w-sm text-sm mx-auto pt-24">{error}</p>
      </Shell>
    );
  }
  if (!data) {
    return (
      <Shell>
        <p className="text-stone-500 text-center text-sm pt-24" style={MONO}>Loading…</p>
      </Shell>
    );
  }

  const projectById = new Map(data.projects.map((p) => [p.id, p]));
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = data.phases.filter((p) => !p.end_date || p.end_date >= today);
  const past = data.phases.filter((p) => p.end_date && p.end_date < today);

  // Per-job rollup for the Jobs tab. Live jobs lead; finished/dead ones
  // collapse under "Past jobs" so a long history doesn't bury today's work.
  const DONE_STATUSES = ["completed", "cancelled", "lost", "declined", "closed"];
  const allJobs = data.projects.map((proj) => ({
    proj,
    awarded: data.awarded.filter((a) => a.project_id === proj.id),
    quotes: data.quotes.filter((q) => q.project_id === proj.id),
    bids: data.bids.filter((b) => b.project_id === proj.id),
    files: data.files.filter((f) => f.project_id === proj.id),
    selections: data.selections.filter((s) => s.project_id === proj.id),
    phases: data.phases.filter((p) => p.project_id === proj.id),
    inspections: (data.inspections || []).filter((i) => i.project_id === proj.id),
    scope: (data.scope || []).filter((s) => s.project_id === proj.id),
  }));
  const jobs = allJobs
    .filter((j) => !DONE_STATUSES.includes(j.proj.status))
    .sort((a, b) => b.phases.length - a.phases.length);
  const pastJobs = allJobs.filter((j) => DONE_STATUSES.includes(j.proj.status));

  return (
    <Shell>
      {/* header */}
      <header className="relative border-b border-white/[0.06]">
        <div className="max-w-2xl mx-auto px-6 pt-10 pb-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <span className="h-[3px] w-7 bg-amber-500" />
                <p className="text-[10px] tracking-[0.4em] uppercase text-amber-500/90" style={MONO}>
                  Penney Construction
                </p>
              </div>
              <h1 className="mt-4 text-[1.9rem] leading-tight font-extrabold uppercase text-stone-100" style={DISPLAY}>
                {data.sub.company_name}
              </h1>
              {data.sub.contact_name && (
                <p className="mt-1 text-[13px] text-stone-500">{data.sub.contact_name}</p>
              )}
            </div>
            <button
              onClick={signOut}
              className="shrink-0 text-[11px] uppercase tracking-[0.14em] text-stone-500 hover:text-stone-300 py-2"
              style={MONO}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* tabs */}
      <nav className="sticky top-0 z-20 bg-[#0b0a08]/85 backdrop-blur-md border-b border-white/[0.06]">
        <div className="max-w-2xl mx-auto flex px-3">
          {([["schedule", "Schedule"], ["jobs", "Jobs"], ["field", "Daily Log"]] as [Tab, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`relative flex-1 py-4 text-[11px] uppercase tracking-[0.14em] transition-colors ${
                tab === key ? "text-amber-400" : "text-stone-500 hover:text-stone-300"
              }`}
              style={MONO}
            >
              {label}
              {tab === key && (
                <span className="absolute left-1/2 -translate-x-1/2 bottom-0 h-[2px] w-10 bg-amber-500 rounded-full shadow-[0_0_8px_rgba(245,158,11,.6)]" />
              )}
            </button>
          ))}
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-5 py-7 pb-16">
        {tab === "schedule" && (
          <>
            {upcoming.length === 0 && (
              <p className="text-[13px] text-stone-500 text-center py-10">
                Nothing on the schedule right now. We&apos;ll add you when your next phase is booked.
              </p>
            )}
            {upcoming.length > 0 && (
              <section className="space-y-3">
                {upcoming.map((p) => {
                  const proj = projectById.get(p.project_id);
                  return (
                    <div key={p.id} className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-[15px] font-semibold text-stone-100">{p.name}</p>
                        <p className="shrink-0 text-[12px] text-amber-400" style={MONO}>
                          {fmtDate(p.start_date)}
                          {p.end_date && p.end_date !== p.start_date ? ` – ${fmtDate(p.end_date)}` : ""}
                        </p>
                      </div>
                      {proj && (
                        <p className="mt-1 text-[12px] text-stone-500" style={MONO}>
                          {proj.name}
                          {proj.address ? ` · ${proj.address}` : ""}
                        </p>
                      )}
                      {p.description && (
                        <p className="mt-2 text-[13px] leading-relaxed text-stone-400">{p.description}</p>
                      )}
                      {proj?.address && (
                        <a
                          href={`https://maps.google.com/?q=${encodeURIComponent(proj.address)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-block text-[11px] uppercase tracking-[0.14em] text-amber-500/90"
                          style={MONO}
                        >
                          Directions →
                        </a>
                      )}
                    </div>
                  );
                })}
              </section>
            )}
            {past.length > 0 && (
              <details className="mt-6">
                <summary
                  className="cursor-pointer text-[11px] uppercase tracking-[0.24em] text-stone-500"
                  style={MONO}
                >
                  Past work ({past.length})
                </summary>
                <div className="mt-3 space-y-2">
                  {past.map((p) => {
                    const proj = projectById.get(p.project_id);
                    return (
                      <div key={p.id} className="rounded-xl border border-white/[0.05] px-4 py-3">
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="text-[13px] text-stone-400">{p.name}</p>
                          <p className="shrink-0 text-[11px] text-stone-600" style={MONO}>
                            {fmtDate(p.start_date)}
                          </p>
                        </div>
                        {proj && <p className="text-[11px] text-stone-600" style={MONO}>{proj.name}</p>}
                      </div>
                    );
                  })}
                </div>
              </details>
            )}
          </>
        )}

        {tab === "jobs" && (
          <>
            {jobs.length === 0 && pastJobs.length === 0 && (
              <p className="text-[13px] text-stone-500 text-center py-10">No jobs on file yet.</p>
            )}
            {jobs.length === 0 && pastJobs.length > 0 && (
              <p className="text-[13px] text-stone-500 text-center py-10">No active jobs right now.</p>
            )}
            <div className="space-y-3">
              {jobs.map(({ proj, awarded, quotes, bids, files, selections, phases, inspections, scope }) => {
                const open = openJob === proj.id;
                const workTotal =
                  awarded.reduce((s, a) => s + (a.amount || 0), 0) +
                  quotes
                    .filter((q) => q.status === "approved" || q.status === "accepted")
                    .reduce((s, q) => s + (q.amount || 0), 0);
                return (
                  <div key={proj.id} className="rounded-2xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
                    <button
                      onClick={() => setOpenJob(open ? null : proj.id)}
                      className="w-full text-left p-4"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-[15px] font-semibold text-stone-100">{proj.name}</p>
                        {workTotal > 0 && (
                          <p className="shrink-0 text-[13px] text-amber-400" style={MONO}>{fmt(workTotal)}</p>
                        )}
                      </div>
                      <p className="mt-1 text-[12px] text-stone-500" style={MONO}>
                        {proj.project_number}
                        {proj.address ? ` · ${proj.address}` : ""}
                      </p>
                      <span
                        className={`mt-2 inline-block rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.14em] ${
                          proj.status === "in_progress"
                            ? "border-emerald-500/40 text-emerald-400"
                            : proj.status === "contracted"
                              ? "border-amber-500/40 text-amber-400"
                              : "border-white/15 text-stone-400"
                        }`}
                        style={MONO}
                      >
                        {statusLabel(proj.status)}
                      </span>
                    </button>

                    {open && (
                      <div className="border-t border-white/[0.06] px-4 py-4 space-y-5">
                        {/* scope on the current proposal — descriptions only, no client pricing */}
                        {scope.length > 0 && (
                          <div>
                            <p className="text-[10px] tracking-[0.3em] uppercase text-stone-500 mb-2" style={MONO}>
                              Scope of work
                            </p>
                            <div className="space-y-2.5">
                              {scope.map((s, i) => (
                                <div key={i} className="border-l-2 border-white/15 pl-3">
                                  <p className="text-[14px] font-medium text-stone-100">
                                    {s.description}
                                    <span className="ml-2 text-[10px] uppercase tracking-[0.14em] text-stone-500" style={MONO}>
                                      {s.trade}
                                    </span>
                                  </p>
                                  {s.scope && (
                                    <p className="mt-1 text-[13px] leading-relaxed text-stone-400 whitespace-pre-line">{s.scope}</p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* your work */}
                        {(awarded.length > 0 || quotes.length > 0 || bids.length > 0) && (
                          <div>
                            <p className="text-[10px] tracking-[0.3em] uppercase text-stone-500 mb-2" style={MONO}>
                              Your work
                            </p>
                            <div className="space-y-2.5">
                              {awarded.map((a) => (
                                <div key={a.id} className="border-l-2 border-amber-500 pl-3">
                                  <div className="flex items-baseline justify-between gap-3">
                                    <p className="text-[14px] font-medium text-stone-100">{a.description}</p>
                                    {a.amount != null && (
                                      <p className="shrink-0 text-[13px] text-stone-300" style={MONO}>{fmt(a.amount)}</p>
                                    )}
                                  </div>
                                  {a.scope && (
                                    <p className="mt-1 text-[13px] leading-relaxed text-stone-400">{a.scope}</p>
                                  )}
                                </div>
                              ))}
                              {quotes.map((q) => (
                                <div key={q.id} className="border-l-2 border-white/15 pl-3">
                                  <div className="flex items-baseline justify-between gap-3">
                                    <p className="text-[14px] font-medium text-stone-200">
                                      {q.trade || "Quote"}
                                      <span className="ml-2 text-[10px] uppercase tracking-[0.14em] text-stone-500" style={MONO}>
                                        {q.status.replace(/_/g, " ")}
                                      </span>
                                    </p>
                                    {q.amount != null && (
                                      <p className="shrink-0 text-[13px] text-stone-300" style={MONO}>{fmt(q.amount)}</p>
                                    )}
                                  </div>
                                  {q.scope && (
                                    <p className="mt-1 text-[13px] leading-relaxed text-stone-400">{q.scope}</p>
                                  )}
                                  {q.pdf_url && (
                                    <a
                                      href={q.pdf_url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="mt-1 inline-block text-[11px] uppercase tracking-[0.14em] text-amber-500/90"
                                      style={MONO}
                                    >
                                      Your quote (PDF) →
                                    </a>
                                  )}
                                </div>
                              ))}
                              {bids.map((b) => (
                                <div key={b.id} className="border-l-2 border-white/15 pl-3">
                                  <div className="flex items-baseline justify-between gap-3">
                                    <p className="text-[14px] font-medium text-stone-200">
                                      {b.package_name || b.trade || "Bid"}
                                      <span className="ml-2 text-[10px] uppercase tracking-[0.14em] text-stone-500" style={MONO}>
                                        {b.status}
                                      </span>
                                    </p>
                                    {b.amount != null && (
                                      <p className="shrink-0 text-[13px] text-stone-300" style={MONO}>{fmt(b.amount)}</p>
                                    )}
                                  </div>
                                  {b.scope && (
                                    <p className="mt-1 text-[13px] leading-relaxed text-stone-400 whitespace-pre-line">{b.scope}</p>
                                  )}
                                  {b.pdf_url && (
                                    <a
                                      href={b.pdf_url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="mt-1 inline-block text-[11px] uppercase tracking-[0.14em] text-amber-500/90"
                                      style={MONO}
                                    >
                                      Your bid (PDF) →
                                    </a>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* drawings + specs */}
                        {files.length > 0 && (
                          <div>
                            <p className="text-[10px] tracking-[0.3em] uppercase text-stone-500 mb-2" style={MONO}>
                              Drawings &amp; specs
                            </p>
                            <div className="space-y-1.5">
                              {files.map((f) => (
                                <a
                                  key={f.id}
                                  href={f.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] px-3 py-2.5 hover:border-amber-500/40 transition-colors"
                                >
                                  <span className="truncate text-[13px] text-stone-300">{f.filename}</span>
                                  <span className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-stone-500" style={MONO}>
                                    {FILE_LABELS[f.category] || f.category}
                                  </span>
                                </a>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* selections — fixtures, appliances, finishes */}
                        {selections.length > 0 && (
                          <div>
                            <p className="text-[10px] tracking-[0.3em] uppercase text-stone-500 mb-2" style={MONO}>
                              Client selections
                            </p>
                            <div className="space-y-1.5">
                              {selections.map((s) => (
                                <div key={s.id} className="rounded-lg border border-white/[0.06] px-3 py-2.5">
                                  <p className="text-[13px] text-stone-300">
                                    <span className="text-stone-500">{s.category}: </span>
                                    {s.description || ""}
                                  </p>
                                  <p className="mt-0.5 text-[12px]" style={MONO}>
                                    {s.selected_value ? (
                                      <span className="text-emerald-400">{s.selected_value}</span>
                                    ) : (
                                      <span className="text-stone-600">Not decided yet</span>
                                    )}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* inspections */}
                        {inspections.length > 0 && (
                          <div>
                            <p className="text-[10px] tracking-[0.3em] uppercase text-stone-500 mb-2" style={MONO}>
                              Inspections
                            </p>
                            <div className="space-y-1.5">
                              {inspections.map((insp) => (
                                <div key={insp.id} className="rounded-lg border border-white/[0.06] px-3 py-2.5">
                                  <div className="flex items-baseline justify-between gap-3">
                                    <p className="text-[13px] text-stone-300">
                                      {insp.name}
                                      {insp.is_final && (
                                        <span className="ml-2 text-[10px] uppercase tracking-[0.14em] text-stone-500" style={MONO}>
                                          Final
                                        </span>
                                      )}
                                    </p>
                                    <p className="shrink-0 text-[11px] uppercase tracking-[0.14em]" style={MONO}>
                                      {insp.status === "passed" ? (
                                        <span className="text-emerald-400">
                                          Passed{insp.completed_at ? ` ${fmtDate(insp.completed_at.slice(0, 10))}` : ""}
                                        </span>
                                      ) : insp.status === "failed" ? (
                                        <span className="text-red-400">Failed</span>
                                      ) : (
                                        <span className="text-stone-500">Pending</span>
                                      )}
                                    </p>
                                  </div>
                                  {insp.notes && (
                                    <p className="mt-1 text-[12px] leading-relaxed text-stone-500">{insp.notes}</p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* schedule on this job */}
                        {phases.length > 0 && (
                          <div>
                            <p className="text-[10px] tracking-[0.3em] uppercase text-stone-500 mb-2" style={MONO}>
                              Your dates on this job
                            </p>
                            <div className="space-y-1">
                              {phases.map((p) => (
                                <div key={p.id} className="flex items-baseline justify-between gap-3">
                                  <p className="text-[13px] text-stone-300">{p.name}</p>
                                  <p className="shrink-0 text-[12px] text-stone-500" style={MONO}>
                                    {fmtDate(p.start_date)}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {pastJobs.length > 0 && (
              <details className="mt-6">
                <summary
                  className="cursor-pointer text-[11px] uppercase tracking-[0.24em] text-stone-500"
                  style={MONO}
                >
                  Past jobs ({pastJobs.length})
                </summary>
                <div className="mt-3 space-y-2">
                  {pastJobs.map(({ proj }) => (
                    <div key={proj.id} className="rounded-xl border border-white/[0.05] px-4 py-3">
                      <p className="text-[13px] text-stone-400">{proj.name}</p>
                      <p className="text-[11px] text-stone-600" style={MONO}>
                        {proj.project_number}
                        {proj.address ? ` · ${proj.address}` : ""}
                      </p>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </>
        )}

        {tab === "field" && <FieldTab field={field} reload={loadField} />}

        <p className="mt-10 text-center text-[12px] text-stone-600">
          Questions? Call the office at{" "}
          <a href={`tel:${OFFICE_PHONE}`} className="text-stone-400 underline underline-offset-2">
            {OFFICE_PHONE}
          </a>
        </p>
      </main>
    </Shell>
  );
}

const fmtLogTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** Best-effort phone GPS fix — never blocks the clock-in. */
function getLocation(): Promise<{ lat: number; lng: number; accuracy?: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    const timer = setTimeout(() => resolve(null), 6000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 5500, maximumAge: 60000 },
    );
  });
}

const inputCls =
  "w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5 text-[14px] text-stone-200 outline-none focus:border-amber-500/50";
const btnCls =
  "rounded-lg bg-amber-500 px-4 py-2.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-stone-950 disabled:opacity-40";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] tracking-[0.3em] uppercase text-stone-500 mb-2" style={MONO}>
      {children}
    </p>
  );
}

/**
 * Daily Log tab: time clock, post an update (photos + note), send a
 * quote/invoice PDF, and the recent activity feed on the sub's jobs.
 */
function FieldTab({ field, reload }: { field: FieldData | null; reload: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const [clockJob, setClockJob] = useState("");
  const [postJob, setPostJob] = useState("");
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const [docJob, setDocJob] = useState("");
  const [docType, setDocType] = useState<"quote" | "invoice">("quote");
  const [docFile, setDocFile] = useState<File | null>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  // Re-render every 30s so the "on the clock" elapsed time stays honest.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  if (!field) {
    return <p className="text-stone-500 text-center text-sm py-10" style={MONO}>Loading…</p>;
  }

  const jobs = field.jobs;
  const clockJobId = clockJob || jobs[0]?.id || "";
  const postJobId = postJob || jobs[0]?.id || "";
  const docJobId = docJob || jobs[0]?.id || "";

  const flash = (kind: "ok" | "err", text: string) => {
    setNotice({ kind, text });
    setTimeout(() => setNotice(null), 6000);
  };

  async function clockIn() {
    if (!clockJobId) return;
    setBusy("clock");
    const loc = await getLocation();
    const res = await fetch("/api/sub-portal/clock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "in", projectId: clockJobId, loc }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return flash("err", d.error || "Couldn't clock in. Try again.");
    flash("ok", "You're on the clock.");
    reload();
  }

  async function clockOut() {
    setBusy("clock");
    const res = await fetch("/api/sub-portal/clock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "out" }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return flash("err", d.error || "Couldn't clock out. Try again.");
    flash("ok", `Clocked out — ${d.hours} h. Thanks!`);
    reload();
  }

  async function postUpdate() {
    if (!postJobId) return;
    if (!note.trim() && photos.length === 0) {
      return flash("err", "Add a note or a photo first.");
    }
    setBusy("post");
    const res = await fetch("/api/sub-portal/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: postJobId, text: note, pendingPhotoCount: photos.length }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.logId) {
      setBusy(null);
      return flash("err", d.error || "Couldn't post. Try again.");
    }
    let failed = 0;
    for (const photo of photos) {
      // Shrink on-device first — full-size phone photos stall on job-site signal.
      const blob = await compressImage(photo).catch(() => photo);
      const fd = new FormData();
      fd.append("logId", d.logId);
      fd.append("file", blob, "photo.jpg");
      const up = await fetch("/api/sub-portal/logs/photo", { method: "POST", body: fd }).catch(() => null);
      if (!up || !up.ok) failed += 1;
    }
    setBusy(null);
    setNote("");
    setPhotos([]);
    if (photoInputRef.current) photoInputRef.current.value = "";
    flash(failed > 0 ? "err" : "ok", failed > 0 ? `Posted, but ${failed} photo(s) didn't upload.` : "Posted. The office sees it now.");
    reload();
  }

  async function sendDoc() {
    if (!docJobId || !docFile) return flash("err", "Pick a job and a file first.");
    setBusy("doc");
    const fd = new FormData();
    fd.append("file", docFile);
    fd.append("projectId", docJobId);
    fd.append("docType", docType);
    const res = await fetch("/api/sub-portal/upload", { method: "POST", body: fd });
    const d = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return flash("err", d.error || "Couldn't send that. Try again.");
    setDocFile(null);
    if (docInputRef.current) docInputRef.current.value = "";
    flash("ok", d.message || "Received. We'll take a look.");
  }

  const elapsed = field.clock
    ? Math.max(0, (Date.now() - new Date(field.clock.started_at).getTime()) / 3_600_000)
    : 0;

  const jobPicker = (value: string, onChange: (v: string) => void) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
      {jobs.map((j) => (
        <option key={j.id} value={j.id} className="bg-stone-900">
          {j.name}
        </option>
      ))}
    </select>
  );

  return (
    <div className="space-y-6">
      {notice && (
        <p
          className={`rounded-lg border px-3 py-2.5 text-[13px] ${
            notice.kind === "ok"
              ? "border-emerald-500/40 text-emerald-400"
              : "border-red-500/40 text-red-400"
          }`}
        >
          {notice.text}
        </p>
      )}

      {/* time clock */}
      <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
        <SectionLabel>Time clock</SectionLabel>
        {field.clock ? (
          <div>
            <p className="text-[15px] font-semibold text-stone-100">{field.clock.project_name}</p>
            <p className="mt-1 text-[12px] text-emerald-400" style={MONO}>
              On the clock since{" "}
              {new Date(field.clock.started_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}{" "}
              · {elapsed.toFixed(1)} h
            </p>
            <button onClick={clockOut} disabled={busy === "clock"} className={`${btnCls} mt-3`}>
              {busy === "clock" ? "Working…" : "Clock out"}
            </button>
          </div>
        ) : jobs.length === 0 ? (
          <p className="text-[13px] text-stone-500">No active jobs to clock into.</p>
        ) : (
          <div className="space-y-3">
            {jobPicker(clockJobId, setClockJob)}
            <button onClick={clockIn} disabled={busy === "clock"} className={btnCls}>
              {busy === "clock" ? "Working…" : "Clock in"}
            </button>
          </div>
        )}
      </section>

      {/* post an update */}
      {jobs.length > 0 && (
        <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
          <SectionLabel>Post an update</SectionLabel>
          <div className="space-y-3">
            {jobPicker(postJobId, setPostJob)}
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="What got done today?"
              className={inputCls}
            />
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => setPhotos(Array.from(e.target.files ?? []))}
              className="block w-full text-[12px] text-stone-400 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-[12px] file:text-stone-200"
            />
            <button onClick={postUpdate} disabled={busy === "post"} className={btnCls}>
              {busy === "post" ? "Posting…" : `Post${photos.length > 0 ? ` (${photos.length} photo${photos.length > 1 ? "s" : ""})` : ""}`}
            </button>
          </div>
        </section>
      )}

      {/* send a quote / invoice */}
      {jobs.length > 0 && (
        <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
          <SectionLabel>Send us a quote or invoice</SectionLabel>
          <div className="space-y-3">
            {jobPicker(docJobId, setDocJob)}
            <div className="flex gap-2">
              {(["quote", "invoice"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setDocType(t)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-[11px] uppercase tracking-[0.14em] ${
                    docType === t
                      ? "border-amber-500/60 text-amber-400"
                      : "border-white/10 text-stone-500"
                  }`}
                  style={MONO}
                >
                  {t}
                </button>
              ))}
            </div>
            <input
              ref={docInputRef}
              type="file"
              accept="application/pdf,image/*"
              onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
              className="block w-full text-[12px] text-stone-400 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-[12px] file:text-stone-200"
            />
            <button onClick={sendDoc} disabled={busy === "doc" || !docFile} className={btnCls}>
              {busy === "doc" ? "Reading the document…" : `Send ${docType}`}
            </button>
            <p className="text-[11px] text-stone-600">
              PDF or a clear photo. It goes straight to the office on the job you picked.
            </p>
          </div>
        </section>
      )}

      {/* recent activity */}
      <section>
        <SectionLabel>Recent activity on your jobs</SectionLabel>
        {field.logs.length === 0 && (
          <p className="text-[13px] text-stone-500 py-6 text-center">No field updates yet.</p>
        )}
        <div className="space-y-3">
          {field.logs.map((l) => (
            <div key={l.id} className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-[14px] font-semibold text-stone-100">
                  {l.author_name}
                  {l.is_mine && (
                    <span className="ml-2 text-[10px] uppercase tracking-[0.14em] text-amber-500/80" style={MONO}>
                      You
                    </span>
                  )}
                </p>
                <p className="shrink-0 text-[11px] text-stone-500" style={MONO}>
                  {fmtLogTime(l.started_at)}
                </p>
              </div>
              <p className="text-[12px] text-stone-500" style={MONO}>{l.project_name}</p>
              {l.status === "in_progress" && (
                <p className="mt-1 text-[12px] text-emerald-400" style={MONO}>On site now</p>
              )}
              {l.text && (
                <p className="mt-2 text-[13px] leading-relaxed text-stone-300 whitespace-pre-line">{l.text}</p>
              )}
              {l.photo_thumb_urls.length > 0 && (
                <div className="mt-3 grid grid-cols-3 gap-1.5">
                  {l.photo_thumb_urls.map((u, i) => (
                    <a key={i} href={l.photo_urls[i] ?? u} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt="" className="aspect-square w-full rounded-lg object-cover" loading="lazy" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen bg-[#0b0a08] text-stone-200"
      style={{ fontFamily: "var(--font-geist-sans), sans-serif" }}
    >
      {children}
    </div>
  );
}
