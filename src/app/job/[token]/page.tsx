"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";

const OFFICE_EMAIL = "jbetancur@penneyconstructioninc.com";
const OFFICE_PHONE = "978-621-4387";
// Same code on every Penney jobsite — surfaced here so the crew stops calling for it.
const LOCKBOX_CODE = "4387";

// Same architectural-editorial palette as the client portal — one visual system.
const SERIF = { fontFamily: "var(--font-playfair), Georgia, serif" } as const;
const GARA = { fontFamily: "var(--font-cormorant), Georgia, serif" } as const;

const fmtDate = (d: string | null) =>
  d ? new Date(d + (d.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "TBD";
const weekOf = (d: string | null) => {
  if (!d) return "TBD";
  const dt = new Date(d + (d.length === 10 ? "T00:00:00" : ""));
  const day = dt.getDay();
  dt.setDate(dt.getDate() - ((day + 6) % 7));
  return `Week of ${dt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
};

const DAY = 86400000;
const durationWeeks = (start: string | null, end: string | null): number | null => {
  if (!start || !end) return null;
  const s = Date.parse(start + (start.length === 10 ? "T00:00:00" : ""));
  const e = Date.parse(end + (end.length === 10 ? "T00:00:00" : ""));
  if (Number.isNaN(s) || Number.isNaN(e)) return null;
  return Math.max(1, Math.round((Math.round((e - s) / DAY) + 1) / 7));
};
const durationLabel = (weeks: number | null): string =>
  weeks == null ? "" : weeks === 1 ? "1 week" : `${weeks} weeks`;

const STAGE_RULES: [RegExp, string][] = [
  [/permit|mobiliz|demo|site|excavat|foundation|footing|grad|sitework/i, "Sitework"],
  [/fram|roof|exterior|dry.?in|sheath|window|siding|structural|steel|deck/i, "Structure"],
  [/rough|electric|plumb|hvac|mechanical|insulat|system/i, "Systems"],
  [/drywall|plaster|paint|floor|carpentry|trim|tile|cabinet|finish|millwork|counter/i, "Finishes"],
  [/punch|final|inspection|closeout|clean|walkthrough|complete|hand.?over/i, "Closeout"],
];
const stageFor = (name: string): string | null => {
  for (const [re, stage] of STAGE_RULES) if (re.test(name)) return stage;
  return null;
};

const fmtSize = (bytes: number) =>
  bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const FILE_GROUPS: { category: string; label: string }[] = [
  { category: "construction_drawings", label: "Construction Drawings" },
  { category: "specs", label: "Specifications" },
  { category: "permits", label: "Permits" },
];

interface JobFile { id: string; filename: string; category: string; mime_type: string | null; size: number; created_at: string; url: string | null }
interface Phase { id: string; name: string; description: string | null; start_date: string | null; end_date: string | null; status: string; firm: boolean }
interface Selection { id: string; category: string; description: string | null; status: "pending" | "selected"; selected_value: string | null }
interface ChangeOrder { id: string; change_order_number: number; title: string; description: string | null }
interface ScopeItem { title: string; details: string | null }
interface ScopeSection { title: string | null; items: ScopeItem[] }
interface JobData {
  project: { name: string; project_number: string; address: string; status: string };
  pm: { name: string | null; phone: string | null; email: string | null } | null;
  schedule: Phase[];
  files: JobFile[];
  selections: Selection[];
  change_orders: ChangeOrder[];
  scope: ScopeSection[];
}

type Tab = "drawings" | "schedule" | "scope" | "info";

export default function CrewJobPage() {
  const { token } = useParams();
  const [data, setData] = useState<JobData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("drawings");

  const load = useCallback(() => {
    fetch(`/api/job?token=${token}`)
      .then((r) => r.json())
      .then((d) => { if (d.error) setError(d.error); else setData(d); setLoading(false); })
      .catch(() => { setError("We couldn't load this job."); setLoading(false); });
  }, [token]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Shell><div className="animate-pulse text-[#a89c8a] tracking-[0.3em] text-xs uppercase">Loading</div></Shell>;
  if (error) return <Shell><p className="text-[#9a3412] text-center px-8 max-w-sm" style={SERIF}>{error}</p></Shell>;
  if (!data) return null;

  const drawingCount = data.files.filter((f) => f.category === "construction_drawings").length;
  const decided = data.selections.filter((s) => s.status === "selected");
  const undecided = data.selections.filter((s) => s.status !== "selected");
  const mapsUrl = data.project.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(data.project.address)}`
    : null;

  // Overall build progress (completed phases + half-credit for the active one).
  const total = data.schedule.length;
  const done = data.schedule.filter((p) => p.status === "completed").length;
  const current = data.schedule.find((p) => p.status === "in_progress");
  const pct = total ? Math.round(((done + (current ? 0.5 : 0)) / total) * 100) : 0;

  return (
    <div className="min-h-screen bg-[#f4efe6] text-[#2b2620]" style={{ fontFamily: "var(--font-geist-sans), sans-serif" }}>
      <style>{`
        @keyframes pcRise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
        @keyframes pcGrow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        @keyframes pcPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(217,119,6,.45); } 50% { box-shadow: 0 0 0 7px rgba(217,119,6,0); } }
        .pc-rise { opacity: 0; animation: pcRise .7s cubic-bezier(.2,.7,.2,1) forwards; }
        .pc-pulse { animation: pcPulse 2.2s ease-in-out infinite; }
      `}</style>

      {/* ---------------- HERO ---------------- */}
      <header className="relative overflow-hidden bg-[#1c1815] text-[#f4efe6]">
        <div className="absolute inset-0 opacity-70" style={{ background: "radial-gradient(120% 80% at 85% -10%, rgba(217,119,6,.22), transparent 55%)" }} />
        <div className="absolute inset-0 opacity-[0.06]" style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")" }} />
        <div className="relative max-w-2xl mx-auto px-6 pt-12 pb-8">
          <div className="pc-rise flex items-center gap-2.5" style={{ animationDelay: "0ms" }}>
            <span className="h-px w-6 bg-[#d97706]" />
            <p className="text-[10px] tracking-[0.34em] uppercase text-[#d9a066]">Penney Construction · Job Site</p>
          </div>
          <h1 className="pc-rise mt-4 text-[2.6rem] leading-[1.05] font-medium" style={{ ...SERIF, animationDelay: "70ms" }}>{data.project.name}</h1>
          <p className="pc-rise mt-2 text-[#b6ab9a] text-sm" style={{ animationDelay: "120ms" }}>{data.project.address || data.project.project_number}</p>

          {total > 0 && (
            <div className="pc-rise mt-9" style={{ animationDelay: "180ms" }}>
              <div className="flex items-end justify-between mb-2.5">
                <span className="text-xs tracking-[0.18em] uppercase text-[#8f8475]">{current ? current.name : pct === 100 ? "Complete" : "Underway"}</span>
                <span style={GARA} className="text-2xl leading-none text-[#f4efe6]">{pct}<span className="text-[#d9a066] text-base">%</span></span>
              </div>
              <div className="h-[5px] rounded-full bg-[#332c26] overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-[#b45309] to-[#f0a04b] origin-left" style={{ width: `${pct}%`, animation: "pcGrow 1.1s cubic-bezier(.2,.7,.2,1) .25s both" }} />
              </div>
            </div>
          )}
          <p className="pc-rise mt-7 text-[13px] text-[#8f8475]" style={{ animationDelay: "240ms" }}>
            {data.project.project_number}
            {data.pm?.name && <> · Site lead <span className="text-[#cbbfac]">{data.pm.name}</span></>}
          </p>
        </div>
      </header>

      {/* ---------------- TABS ---------------- */}
      <nav className="sticky top-0 z-20 bg-[#f4efe6]/92 backdrop-blur border-b border-[#e3d9c8]">
        <div className="max-w-2xl mx-auto flex px-3">
          {([["drawings", "Drawings"], ["schedule", "Schedule"], ["scope", "Scope"], ["info", "Info"]] as [Tab, string][]).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className="relative flex-1 py-4 text-[13px] tracking-wide transition-colors"
              style={{ color: tab === key ? "#2b2620" : "#a99e8c" }}>
              <span className="inline-flex items-center gap-1.5">
                {label}
                {key === "drawings" && drawingCount > 0 && (
                  <span className="inline-flex items-center justify-center text-[10px] font-semibold text-white bg-[#d97706] rounded-full min-w-[16px] h-4 px-1">{drawingCount}</span>
                )}
              </span>
              {tab === key && <span className="absolute left-1/2 -translate-x-1/2 bottom-0 h-[2px] w-8 bg-[#d97706] rounded-full" />}
            </button>
          ))}
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-5 py-7">
        {/* ---------------- DRAWINGS ---------------- */}
        {tab === "drawings" && (
          data.files.length === 0 ? <Empty>No drawings posted yet. Check with the office.</Empty> : (
            <div className="space-y-7">
              {FILE_GROUPS.map(({ category, label }) => {
                const group = data.files.filter((f) => f.category === category);
                if (group.length === 0) return null;
                return (
                  <section key={category}>
                    <div className="flex items-center gap-3 mb-3.5">
                      <span className="text-[11px] tracking-[0.24em] uppercase text-[#a0916f]">{label}</span>
                      <span className="h-px flex-1 bg-[#e4dac9]" />
                    </div>
                    <div className="grid gap-2.5">
                      {group.map((f, i) => {
                        const isPdf = f.mime_type?.includes("pdf");
                        const isImage = f.mime_type?.startsWith("image/");
                        return (
                          <a key={f.id} href={f.url || undefined} target="_blank" rel="noreferrer"
                            className={`pc-rise group rounded-xl border border-[#e8decd] bg-[#fffdf8] hover:border-[#d97706] hover:bg-[#fdf6ea] p-3.5 flex items-center gap-3.5 transition-all hover:shadow-sm ${f.url ? "" : "opacity-50 pointer-events-none"}`}
                            style={{ animationDelay: `${i * 50}ms` }}>
                            <span className="shrink-0 w-11 h-11 rounded-lg flex items-center justify-center bg-[#efe7d8] text-[#b09a78]">
                              {isPdf ? (
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                              ) : isImage ? (
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M4 6h16a0 0 0 010 0v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6a0 0 0 010 0z" /><circle cx="9" cy="9" r="1.5" /></svg>
                              ) : (
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                              )}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-[15px] truncate" style={SERIF}>{f.filename}</span>
                              <span className="block text-xs text-[#8c8275] mt-0.5" style={GARA}>{fmtSize(f.size)} · {fmtDate(f.created_at.slice(0, 10))}</span>
                            </span>
                            <span className="shrink-0 text-[11px] tracking-[0.12em] uppercase text-[#b45309] group-hover:text-[#d97706]">Open</span>
                          </a>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
              <p className="text-xs text-[#a99e8c] text-center leading-relaxed">Drawings open in a new tab — pinch to zoom works there.</p>
            </div>
          )
        )}

        {/* ---------------- SCHEDULE ---------------- */}
        {tab === "schedule" && (
          total === 0 ? <Empty>No schedule posted yet.</Empty> : (
            <>
            <p className="text-xs text-[#a99e8c] mb-1 leading-relaxed px-0.5">
              <span className="text-[#5d6b4a] font-medium">Confirmed</span> dates are locked with our subs. <span className="italic">Estimated</span> dates shift as work progresses — check before ordering material.
            </p>
            <div className="relative mt-3">
              {data.schedule.map((p, i) => {
                const isDone = p.status === "completed";
                const isNow = p.status === "in_progress";
                const last = i === data.schedule.length - 1;
                const stage = stageFor(p.name);
                const showStage = !!stage && stage !== (i > 0 ? stageFor(data.schedule[i - 1].name) : null);
                const weeksNum = durationWeeks(p.start_date, p.end_date);
                const chip = isDone ? "" : isNow && weeksNum === 1 ? "this week" : durationLabel(weeksNum);
                return (
                  <div key={p.id}>
                    {showStage && (
                      <div className={`flex items-center gap-3 ${i === 0 ? "mt-1" : "mt-5"} mb-3.5`}>
                        <span className="text-[11px] tracking-[0.24em] uppercase text-[#a0916f]">{stage}</span>
                        <span className="h-px flex-1 bg-[#e4dac9]" />
                      </div>
                    )}
                    <div className="pc-rise relative pl-10 pb-6" style={{ animationDelay: `${i * 60}ms` }}>
                      {!last && <span className="absolute left-[13px] top-7 bottom-0 w-[2px]" style={{ background: isDone ? "#ecc88f" : "#e6dac4" }} />}
                      <span className={`absolute left-0 top-1 flex items-center justify-center w-[27px] h-[27px] rounded-full ${
                        isDone ? "bg-[#d97706] border border-[#d97706]" : isNow ? "bg-[#f4efe6] border-2 border-[#d97706] pc-pulse" : p.firm ? "bg-[#f4efe6] border border-[#d9a066]" : "bg-[#f4efe6] border border-dashed border-[#cdbfa9]"}`}>
                        {isDone ? (
                          <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                        ) : <span className={`w-2 h-2 rounded-full ${isNow ? "bg-[#d97706]" : p.firm ? "bg-[#d9a066]" : "bg-[#cdbfa9]"}`} />}
                      </span>
                      <div className={isNow ? "rounded-2xl bg-[#fffaf0] border border-[#f1dcb4] px-4 py-3.5 -ml-1.5" : ""}>
                        <div className="flex items-baseline justify-between gap-3">
                          <h3 className="text-lg" style={SERIF}>{p.name}</h3>
                          {isNow ? (
                            <span className="shrink-0 text-[10px] tracking-[0.15em] uppercase text-white bg-[#d97706] px-2.5 py-0.5 rounded-full">In Progress</span>
                          ) : isDone ? (
                            <span className="shrink-0 text-[10px] tracking-[0.15em] uppercase text-[#5d6b4a] bg-[#e7edda] px-2.5 py-0.5 rounded-full">Done</span>
                          ) : p.firm ? (
                            <span className="shrink-0 text-[10px] tracking-[0.15em] uppercase text-[#5d6b4a] bg-[#e6ecda] px-2.5 py-0.5 rounded-full">Confirmed</span>
                          ) : (
                            <span className="shrink-0 text-[10px] tracking-[0.15em] uppercase text-[#a99e8c] border border-[#dccdb6] px-2.5 py-0.5 rounded-full">Estimated</span>
                          )}
                        </div>
                        {p.description && <p className="text-sm text-[#7c7264] mt-1 leading-relaxed">{p.description}</p>}
                        <div className="mt-2 flex items-center flex-wrap gap-y-1" style={GARA}>
                          {p.firm || isDone || isNow ? (
                            <span className="text-[17px] text-[#8c8275]">{fmtDate(p.start_date)} – {fmtDate(p.end_date)}</span>
                          ) : (
                            <span className="text-[17px] text-[#a99e8c] italic">{weekOf(p.start_date)}</span>
                          )}
                          {chip && <span className="text-[12px] not-italic text-[#9a8c74] border border-[#e4dac9] rounded-full px-2.5 py-0.5 ml-2.5">{chip}</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            </>
          )
        )}

        {/* ---------------- SCOPE ---------------- */}
        {tab === "scope" && (
          data.scope.length === 0 && data.change_orders.length === 0 ? <Empty>Scope of work will appear here once the estimate is approved.</Empty> : (
            <div className="space-y-7">
              {data.change_orders.length > 0 && (
                <section className="pc-rise rounded-2xl bg-[#fffaf0] border border-[#f1dcb4] p-5">
                  <p className="text-[10px] tracking-[0.26em] uppercase text-[#b45309] mb-3">Approved Changes — these are in the job</p>
                  <ul className="space-y-3.5">
                    {data.change_orders.map((co) => (
                      <li key={co.id}>
                        <p className="text-[15px]" style={SERIF}>No.{co.change_order_number} · {co.title}</p>
                        {co.description && <p className="text-sm text-[#7c7264] mt-0.5 leading-relaxed">{co.description}</p>}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {data.scope.map((section, si) => (
                <section key={si} className="pc-rise" style={{ animationDelay: `${si * 60}ms` }}>
                  {section.title && (
                    <div className="flex items-center gap-3 mb-3.5">
                      <span className="text-[11px] tracking-[0.24em] uppercase text-[#a0916f]">{section.title}</span>
                      <span className="h-px flex-1 bg-[#e4dac9]" />
                    </div>
                  )}
                  <div className="space-y-4">
                    {section.items.map((item, ii) => (
                      <div key={ii} className="rounded-xl bg-[#fffdf8] border border-[#e8decd] p-4">
                        <p className="text-[15px]" style={SERIF}>{item.title}</p>
                        {item.details && <p className="text-sm text-[#7c7264] mt-1 leading-relaxed whitespace-pre-line">{item.details}</p>}
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )
        )}

        {/* ---------------- INFO ---------------- */}
        {tab === "info" && (
          <div className="space-y-5">
            {/* address */}
            <section className="pc-rise rounded-2xl bg-[#fffdf8] border border-[#e8decd] p-6">
              <p className="text-[10px] tracking-[0.26em] uppercase text-[#a99e8c] mb-2">Job Site</p>
              <p className="text-xl leading-snug" style={SERIF}>{data.project.address || "Address on file at the office"}</p>
              {mapsUrl && (
                <a href={mapsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 mt-3 text-[13px] text-[#b45309] font-medium">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><circle cx="12" cy="11" r="2.5" /></svg>
                  Open in Google Maps →
                </a>
              )}
            </section>

            {/* lockbox */}
            <section className="pc-rise rounded-2xl bg-[#1c1815] text-[#f4efe6] p-6 relative overflow-hidden" style={{ animationDelay: "70ms" }}>
              <div className="absolute inset-0 opacity-60" style={{ background: "radial-gradient(100% 70% at 100% 0%, rgba(217,119,6,.18), transparent 60%)" }} />
              <div className="relative flex items-center justify-between gap-4">
                <div>
                  <p className="text-[10px] tracking-[0.3em] uppercase text-[#8f8475]">Lockbox</p>
                  <p className="text-xs text-[#b6ab9a] mt-1">Same code, every Penney jobsite.</p>
                </div>
                <p style={GARA} className="text-5xl leading-none tracking-[0.12em] text-[#f0c89b]">{LOCKBOX_CODE}</p>
              </div>
            </section>

            {/* contacts */}
            <section className="pc-rise rounded-2xl bg-[#fffdf8] border border-[#e8decd] p-6" style={{ animationDelay: "140ms" }}>
              <p className="text-[10px] tracking-[0.26em] uppercase text-[#a99e8c] mb-3">Who to Call</p>
              <ul className="divide-y divide-[#ece3d4]">
                {data.pm?.name && (
                  <li className="py-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[15px]" style={SERIF}>{data.pm.name}</p>
                      <p className="text-xs text-[#a99e8c]">Site lead / PM</p>
                    </div>
                    <div className="flex gap-2">
                      {data.pm.phone && <ContactBtn href={`tel:${data.pm.phone}`} label="Call" />}
                      {data.pm.email && <ContactBtn href={`mailto:${data.pm.email}`} label="Email" />}
                    </div>
                  </li>
                )}
                <li className="py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[15px]" style={SERIF}>Penney Office</p>
                    <p className="text-xs text-[#a99e8c]">{OFFICE_PHONE}</p>
                  </div>
                  <div className="flex gap-2">
                    <ContactBtn href={`tel:${OFFICE_PHONE}`} label="Call" />
                    <ContactBtn href={`mailto:${OFFICE_EMAIL}`} label="Email" />
                  </div>
                </li>
              </ul>
            </section>

            {/* finishes / selections */}
            {data.selections.length > 0 && (
              <section className="pc-rise rounded-2xl bg-[#fffdf8] border border-[#e8decd] p-6" style={{ animationDelay: "210ms" }}>
                <p className="text-[10px] tracking-[0.26em] uppercase text-[#a99e8c] mb-3">Client Selections</p>
                <ul className="divide-y divide-[#ece3d4]">
                  {[...decided, ...undecided].map((s) => (
                    <li key={s.id} className="py-3 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[15px]" style={SERIF}>{s.category}</p>
                        {s.status === "selected" ? (
                          <p className="text-sm text-[#5d6b4a] mt-0.5 flex items-center gap-1.5">
                            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                            <span className="italic" style={GARA}>{s.selected_value}</span>
                          </p>
                        ) : (
                          <p className="text-sm text-[#b45309] mt-0.5">Not decided yet — check before install</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </main>

      {/* ---------------- FOOTER ---------------- */}
      <footer className="max-w-2xl mx-auto px-5 pb-12 pt-2 text-center">
        <p className="text-[11px] tracking-[0.16em] uppercase text-[#a99e8c]">Penney Construction · North Shore, MA · {OFFICE_PHONE}</p>
      </footer>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen flex items-center justify-center bg-[#f4efe6]">{children}</div>;
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-[#e8decd] bg-[#fffdf8] p-10 text-center text-sm text-[#a99e8c]" style={GARA}>{children}</div>;
}
function ContactBtn({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} className="text-[11px] tracking-[0.12em] uppercase text-[#b45309] border border-[#e8decd] hover:border-[#d97706] rounded-full px-3 py-1.5 transition-colors">
      {label}
    </a>
  );
}
