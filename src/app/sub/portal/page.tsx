"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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
interface PortalData {
  sub: { company_name: string; contact_name: string | null };
  projects: Project[];
  phases: Phase[];
  quotes: Quote[];
  bids: Bid[];
  awarded: Awarded[];
  files: PortalFile[];
  selections: Selection[];
}

const FILE_LABELS: Record<string, string> = {
  construction_drawings: "Drawings",
  specs: "Specs",
  permits: "Permits",
};

type Tab = "schedule" | "jobs";

export default function SubPortalPage() {
  const router = useRouter();
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("schedule");
  const [openJob, setOpenJob] = useState<string | null>(null);

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
          {([["schedule", "Schedule"], ["jobs", "Jobs"]] as [Tab, string][]).map(([key, label]) => (
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
              {jobs.map(({ proj, awarded, quotes, bids, files, selections, phases }) => {
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
                    </button>

                    {open && (
                      <div className="border-t border-white/[0.06] px-4 py-4 space-y-5">
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
