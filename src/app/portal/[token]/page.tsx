"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";

const CONTACT_EMAIL = "jbetancur@penneyconstructioninc.com";
const CONTACT_PHONE = "978-621-4387";

// Command-center dark — the app's night-shift language: warm near-black,
// amber accents, signage-weight Archivo display, Plex Mono for every number.
const DISPLAY = { fontFamily: "var(--font-archivo), sans-serif" } as const;
const MONO = { fontFamily: "var(--font-plex-mono), monospace" } as const;

const fmt = (v: number) => `$${Math.abs(Math.round(v)).toLocaleString("en-US")}`;
const fmtDate = (d: string | null) =>
  d ? new Date(d + (d.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "TBD";
// Estimated phases get "week of" granularity — honest about the give in a date
// we haven't locked with a sub yet. Snap to the Monday of that week.
const weekOf = (d: string | null) => {
  if (!d) return "TBD";
  const dt = new Date(d + (d.length === 10 ? "T00:00:00" : ""));
  const day = dt.getDay(); // 0 Sun … 6 Sat
  dt.setDate(dt.getDate() - ((day + 6) % 7)); // back up to Monday
  return `Week of ${dt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
};

const DAY = 86400000;
// Inclusive calendar span of a phase, rounded to whole weeks (min 1).
const durationWeeks = (start: string | null, end: string | null): number | null => {
  if (!start || !end) return null;
  const s = Date.parse(start + (start.length === 10 ? "T00:00:00" : ""));
  const e = Date.parse(end + (end.length === 10 ? "T00:00:00" : ""));
  if (Number.isNaN(s) || Number.isNaN(e)) return null;
  return Math.max(1, Math.round((Math.round((e - s) / DAY) + 1) / 7));
};
const durationLabel = (weeks: number | null): string =>
  weeks == null ? "" : weeks === 1 ? "1 week" : `${weeks} weeks`;

// Group phases into build stages by keyword on the phase name. Returns null when
// a name doesn't map — that phase just stays under the running stage header, so
// custom schedules degrade to a flat list rather than mis-grouping.
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

// "Late October 2026" from a date — early (1–10) / mid (11–20) / late (21+).
const monthBand = (d: string | null | undefined): string => {
  if (!d) return "TBD";
  const dt = new Date(d + (d.length === 10 ? "T00:00:00" : ""));
  const band = dt.getDate() <= 10 ? "Early" : dt.getDate() <= 20 ? "Mid" : "Late";
  return `${band} ${dt.toLocaleDateString("en-US", { month: "long", year: "numeric" })}`;
};

interface SelectionOption { id: string; label: string; description?: string; image_url?: string; price_delta?: number }
interface Selection {
  id: string; category: string; description: string | null; status: "pending" | "selected";
  allowance_amount: number | null; options: SelectionOption[];
  selected_option_id: string | null; selected_value: string | null; sort_order: number;
}
interface Phase { id: string; name: string; description: string | null; start_date: string | null; end_date: string | null; status: string; color: string | null; firm: boolean; event_type?: string | null }
interface ChangeOrder { id: string; change_order_number: number; title: string; description: string | null; status: string; price_impact: number; signed: boolean; approval_token: string | null }
interface Payment { id: string; payment_type: string; description: string | null; amount: number; received_date: string | null; invoice_sent_number: string | null }
interface Financials {
  contract_value: number; adjusted_contract: number; total_payments_received: number;
  deposit_received: number; draws_received: number; final_received: number;
  outstanding_receivable: number; change_order_count: number; change_order_revenue: number;
}
interface PortalPhoto { thumb: string; full: string; date: string }
interface DayPlan { planned_count: number; tasks: { name: string; description: string | null }[] }
interface TodayOnSite { date: string; live_count: number; planned_count: number; tasks: { name: string; description: string | null }[]; tomorrow?: DayPlan }
interface PortalData {
  today_on_site: TodayOnSite | null;
  client_name: string | null;
  project: { name: string; project_number: string; address: string; status: string };
  financials: Financials | null;
  schedule: Phase[]; payments: Payment[]; change_orders: ChangeOrder[]; selections: Selection[];
  photos: PortalPhoto[];
}

type Tab = "schedule" | "photos" | "financials" | "selections";

export default function ClientPortalPage() {
  const { token } = useParams();
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("schedule");
  const [picking, setPicking] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/portal?token=${token}`)
      .then((r) => r.json())
      .then((d) => { if (d.error) setError(d.error); else setData(d); setLoading(false); })
      .catch(() => { setError("We couldn't load your project."); setLoading(false); });
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function pick(selectionId: string, optionId: string) {
    setPicking(selectionId + optionId);
    const res = await fetch("/api/portal/select", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, selectionId, optionId }),
    });
    const d = await res.json();
    setPicking(null);
    if (d.success) load(); else alert(d.error || "Could not save your selection. Please try again.");
  }

  if (loading) return <Shell><div className="animate-pulse text-stone-500 tracking-[0.34em] text-[11px] uppercase" style={MONO}>Loading</div></Shell>;
  if (error) return <Shell><p className="text-red-400 text-center px-8 max-w-sm text-sm">{error}</p></Shell>;
  if (!data) return null;

  const f = data.financials;
  const pendingCount = data.selections.filter((s) => s.status === "pending").length;
  const subject = encodeURIComponent(`${data.project.project_number} — ${data.project.name}`);
  const mailto = `mailto:${CONTACT_EMAIL}?subject=${subject}`;

  // Overall build progress (completed phases + half-credit for the active one).
  const total = data.schedule.length;
  const done = data.schedule.filter((p) => p.status === "completed").length;
  const current = data.schedule.find((p) => p.status === "in_progress");
  const pct = total ? Math.round(((done + (current ? 0.5 : 0)) / total) * 100) : 0;

  // Summary-band position: the phase the client is "on" right now.
  const currentIdx = data.schedule.findIndex((p) => p.status === "in_progress");
  const firstTodoIdx = data.schedule.findIndex((p) => p.status === "not_started");
  const posIdx = currentIdx >= 0 ? currentIdx : done === total ? total - 1 : firstTodoIdx >= 0 ? firstTodoIdx : 0;
  const phasePos = total ? posIdx + 1 : 0;
  const statusLabel = done === total ? "Complete" : current ? "In progress" : done > 0 ? "Underway" : "Starting soon";

  const paidPct = f && f.adjusted_contract > 0 ? Math.min(100, Math.round((f.total_payments_received / f.adjusted_contract) * 100)) : 0;

  return (
    <div className="min-h-screen bg-[#0b0a08] text-stone-200" style={{ fontFamily: "var(--font-geist-sans), sans-serif" }}>
      <style>{`
        @keyframes pcRise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
        @keyframes pcGrow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        @keyframes pcPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(245,158,11,.4); } 50% { box-shadow: 0 0 0 8px rgba(245,158,11,0); } }
        .pc-rise { opacity: 0; animation: pcRise .7s cubic-bezier(.2,.7,.2,1) forwards; }
        .pc-pulse { animation: pcPulse 2.2s ease-in-out infinite; }
        .pc-grid { background-image: linear-gradient(rgba(245,158,11,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(245,158,11,.04) 1px, transparent 1px); background-size: 48px 48px; }
      `}</style>

      {/* ---------------- HERO ---------------- */}
      <header className="relative overflow-hidden border-b border-white/[0.06]">
        {/* amber worklight + blueprint grid + grain */}
        <div className="absolute inset-0 pc-grid" />
        <div className="absolute inset-0" style={{ background: "radial-gradient(120% 90% at 80% -20%, rgba(217,119,6,.28), transparent 55%)" }} />
        <div className="absolute inset-0 opacity-[0.05]" style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")" }} />
        <div className="relative max-w-2xl mx-auto px-6 pt-12 pb-9">
          <div className="pc-rise flex items-center gap-3" style={{ animationDelay: "0ms" }}>
            <span className="h-[3px] w-7 bg-amber-500" />
            <p className="text-[10px] tracking-[0.4em] uppercase text-amber-500/90" style={MONO}>Penney Construction</p>
          </div>
          <h1 className="pc-rise mt-5 text-[2.4rem] leading-[0.98] font-extrabold uppercase tracking-[-0.01em] text-stone-100" style={{ ...DISPLAY, animationDelay: "70ms" }}>
            {data.project.name}
          </h1>
          <p className="pc-rise mt-3 text-[13px] text-stone-500" style={{ ...MONO, animationDelay: "120ms" }}>
            {data.project.address || data.project.project_number}
          </p>

          {/* build progress */}
          {total > 0 && (
            <div className="pc-rise mt-9" style={{ animationDelay: "180ms" }}>
              <div className="flex items-end justify-between mb-2.5">
                <span className="text-[10px] tracking-[0.24em] uppercase text-stone-500" style={MONO}>{current ? current.name : pct === 100 ? "Complete" : "Underway"}</span>
                <span style={MONO} className="text-2xl leading-none font-medium text-stone-100">{pct}<span className="text-amber-500 text-base">%</span></span>
              </div>
              <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-amber-700 to-amber-400 origin-left shadow-[0_0_12px_rgba(245,158,11,.5)]" style={{ width: `${pct}%`, animation: "pcGrow 1.1s cubic-bezier(.2,.7,.2,1) .25s both" }} />
              </div>
            </div>
          )}
          {data.client_name && (
            <p className="pc-rise mt-7 text-[12px] text-stone-500" style={{ animationDelay: "240ms" }}>
              Prepared for <span className="text-stone-300">{data.client_name}</span>
            </p>
          )}
        </div>
      </header>

      {/* ---------------- TABS ---------------- */}
      <nav className="sticky top-0 z-20 bg-[#0b0a08]/85 backdrop-blur-md border-b border-white/[0.06]">
        <div className="max-w-2xl mx-auto flex px-3">
          {([["schedule", "Schedule"], ["photos", "Photos"], ["financials", "Financials"], ["selections", "Selections"]] as [Tab, string][]).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`relative flex-1 py-4 text-[11px] uppercase tracking-[0.14em] transition-colors ${tab === key ? "text-amber-400" : "text-stone-500 hover:text-stone-300"}`}
              style={MONO}>
              <span className="inline-flex items-center gap-1.5">
                {label}
                {key === "selections" && pendingCount > 0 && (
                  <span className="inline-flex items-center justify-center text-[10px] font-semibold text-stone-950 bg-amber-500 rounded-full min-w-[16px] h-4 px-1">{pendingCount}</span>
                )}
              </span>
              {tab === key && <span className="absolute left-1/2 -translate-x-1/2 bottom-0 h-[2px] w-10 bg-amber-500 rounded-full shadow-[0_0_8px_rgba(245,158,11,.6)]" />}
            </button>
          ))}
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-5 py-7">
        {/* ---------------- TODAY AT YOUR HOME ---------------- */}
        {tab === "schedule" && data.today_on_site && (data.today_on_site.live_count > 0 || data.today_on_site.tasks.length > 0 || (data.today_on_site.tomorrow?.tasks.length ?? 0) > 0) && (
          <section className="pc-rise relative mb-5 overflow-hidden rounded-2xl border border-amber-500/25 bg-gradient-to-b from-amber-500/[0.08] to-transparent p-5">
            <div className="absolute inset-0 opacity-50" style={{ background: "radial-gradient(90% 60% at 100% 0%, rgba(217,119,6,.16), transparent 60%)" }} />
            <div className="relative">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] tracking-[0.34em] uppercase text-amber-500" style={MONO}>Today at your home</p>
                {data.today_on_site.live_count > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-emerald-400" style={MONO}>
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,.8)]" />
                    On site now
                  </span>
                )}
              </div>
              <p style={DISPLAY} className="mt-2.5 text-[1.45rem] leading-tight font-bold text-stone-100">
                {data.today_on_site.live_count > 0
                  ? `${data.today_on_site.live_count} crew member${data.today_on_site.live_count === 1 ? "" : "s"} at your home`
                  : data.today_on_site.planned_count > 0
                    ? `${data.today_on_site.planned_count} crew member${data.today_on_site.planned_count === 1 ? "" : "s"} scheduled today`
                    : "Today's plan"}
              </p>
              {data.today_on_site.tasks.length > 0 && (
                <ul className="mt-3.5 space-y-2.5">
                  {data.today_on_site.tasks.map((t, i) => (
                    <li key={i} className="border-l-2 border-amber-500 pl-3">
                      <p className="text-[15px] font-medium text-stone-100">{t.name}</p>
                      {t.description && <p className="mt-0.5 text-[13px] leading-relaxed text-stone-400">{t.description}</p>}
                    </li>
                  ))}
                </ul>
              )}
              {(data.today_on_site.tomorrow?.tasks.length ?? 0) > 0 && (
                <div className="mt-4 border-t border-white/[0.07] pt-3.5">
                  <p className="text-[10px] tracking-[0.34em] uppercase text-stone-500" style={MONO}>
                    And then tomorrow
                    {data.today_on_site.tomorrow!.planned_count > 0 && (
                      <span className="ml-2 tracking-normal text-stone-400">· {data.today_on_site.tomorrow!.planned_count} crew</span>
                    )}
                  </p>
                  <ul className="mt-2.5 space-y-2">
                    {data.today_on_site.tomorrow!.tasks.map((t, i) => (
                      <li key={i} className="border-l-2 border-white/10 pl-3">
                        <p className="text-[15px] font-medium text-stone-300">{t.name}</p>
                        {t.description && <p className="mt-0.5 text-[13px] leading-relaxed text-stone-500">{t.description}</p>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ---------------- SCHEDULE ---------------- */}
        {tab === "schedule" && (
          total === 0 ? <Empty>Your project timeline will appear here once it&apos;s scheduled.</Empty> : (
            <>
            {/* status summary band */}
            <div className="pc-rise flex items-center justify-between gap-4 rounded-xl bg-white/[0.03] border border-white/[0.07] px-4 py-3">
              <div className="flex items-center gap-2.5">
                <span className={`w-2 h-2 rounded-full ${done === total || current ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,.7)]" : "bg-stone-600"}`} />
                <span className="text-[13px] text-stone-300">{statusLabel} · <span style={MONO}>Phase {phasePos} of {total}</span></span>
              </div>
              <div className="text-right">
                <span className="block text-[9px] tracking-[0.22em] uppercase text-stone-500" style={MONO}>Est. completion</span>
                <span style={MONO} className="text-[13px] text-amber-400">{monthBand(data.schedule[total - 1]?.end_date)}</span>
              </div>
            </div>

            <p className="text-xs text-stone-500 mt-3 mb-1 leading-relaxed px-0.5">
              <span className="text-stone-300 font-medium">Confirmed</span> dates are locked with our trades. <span className="italic">Estimated</span> dates shift as work progresses — they&apos;ll firm up as we get closer.
            </p>

            <div className="relative">
              {data.schedule.map((p, i) => {
                const isDone = p.status === "completed";
                const isNow = p.status === "in_progress";
                const isInspection = p.event_type === "inspection";
                const last = i === data.schedule.length - 1;
                const stage = stageFor(p.name);
                const showStage = !!stage && stage !== (i > 0 ? stageFor(data.schedule[i - 1].name) : null);
                const weeksNum = durationWeeks(p.start_date, p.end_date);
                const chip = isDone ? "" : isNow && weeksNum === 1 ? "this week" : durationLabel(weeksNum);
                return (
                  <div key={p.id}>
                    {showStage && (
                      <div className={`flex items-center gap-3 ${i === 0 ? "mt-1" : "mt-6"} mb-3.5`}>
                        <span className="text-[10px] tracking-[0.3em] uppercase text-amber-600/80" style={MONO}>{stage}</span>
                        <span className="h-px flex-1 bg-white/[0.07]" />
                      </div>
                    )}
                    <div className="pc-rise relative pl-10 pb-6" style={{ animationDelay: `${Math.min(i * 55, 500)}ms` }}>
                      {!last && <span className={`absolute left-[13px] top-8 bottom-0 w-px ${isDone ? "bg-amber-600/40" : "bg-white/[0.08]"}`} />}
                      <span className={`absolute left-0 top-1 flex items-center justify-center w-[27px] h-[27px] ${isInspection ? "rotate-45 rounded-[7px]" : "rounded-full"} ${
                        isDone
                          ? isInspection ? "bg-red-500/90 border border-red-500" : "bg-amber-500 border border-amber-500"
                          : isNow ? "bg-[#0b0a08] border-2 border-amber-500 pc-pulse"
                          : isInspection ? "bg-[#0b0a08] border border-red-500/60"
                          : p.firm ? "bg-[#0b0a08] border border-stone-500"
                          : "bg-[#0b0a08] border border-dashed border-stone-700"}`}>
                        {isDone ? (
                          <svg className={`w-3.5 h-3.5 text-stone-950 ${isInspection ? "-rotate-45 text-white" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                        ) : <span className={`w-2 h-2 ${isInspection ? "rounded-[2px] bg-red-500/80" : `rounded-full ${isNow ? "bg-amber-500" : p.firm ? "bg-stone-400" : "bg-stone-700"}`}`} />}
                      </span>
                      <div className={isNow ? "rounded-2xl bg-amber-500/[0.06] border border-amber-500/25 px-4 py-3.5 -ml-1.5" : ""}>
                        <div className="flex items-baseline justify-between gap-3">
                          <h3 className="text-[16px] font-semibold text-stone-100">
                            {isInspection && <span className="mr-2 inline-block h-2 w-2 rotate-45 rounded-[1px] bg-red-500 align-middle" />}
                            {p.name}
                          </h3>
                          {isNow ? (
                            <span className="shrink-0 text-[9px] tracking-[0.16em] uppercase text-stone-950 bg-amber-500 px-2.5 py-0.5 rounded-full font-semibold" style={MONO}>In Progress</span>
                          ) : isDone ? (
                            <span className="shrink-0 text-[9px] tracking-[0.16em] uppercase text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 rounded-full" style={MONO}>Done</span>
                          ) : p.firm ? (
                            <span className="shrink-0 text-[9px] tracking-[0.16em] uppercase text-stone-300 bg-white/[0.06] px-2.5 py-0.5 rounded-full" style={MONO}>Confirmed</span>
                          ) : (
                            <span className="shrink-0 text-[9px] tracking-[0.16em] uppercase text-stone-500 border border-dashed border-stone-700 px-2.5 py-0.5 rounded-full" style={MONO}>Estimated</span>
                          )}
                        </div>
                        {p.description && <p className="text-[13px] text-stone-400 mt-1 leading-relaxed">{p.description}</p>}
                        <div className="mt-2 flex items-center flex-wrap gap-y-1" style={MONO}>
                          {p.firm || isDone || isNow ? (
                            <span className="text-[12px] text-stone-400">{fmtDate(p.start_date)} – {fmtDate(p.end_date)}</span>
                          ) : (
                            <span className="text-[12px] text-stone-500 italic">{weekOf(p.start_date)}</span>
                          )}
                          {chip && <span className="text-[10px] text-stone-500 border border-white/[0.08] rounded-full px-2.5 py-0.5 ml-2.5">{chip}</span>}
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

        {/* ---------------- PHOTOS ---------------- */}
        {tab === "photos" && (
          data.photos.length === 0 ? <Empty>Progress photos will appear here as our crew posts from your job site.</Empty> : (
            <div className="space-y-8">
              {(() => {
                // Group consecutive photos by day — the API already returns newest first.
                const groups: { date: string; items: PortalPhoto[] }[] = [];
                for (const ph of data.photos) {
                  const last = groups[groups.length - 1];
                  if (last && last.date === ph.date) last.items.push(ph);
                  else groups.push({ date: ph.date, items: [ph] });
                }
                return groups.map((g, gi) => (
                  <section key={`${g.date}-${gi}`} className="pc-rise" style={{ animationDelay: `${Math.min(gi * 60, 300)}ms` }}>
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-[10px] tracking-[0.3em] uppercase text-amber-600/80" style={MONO}>{fmtDate(g.date)}</span>
                      <span className="h-px flex-1 bg-white/[0.07]" />
                      <span className="text-[10px] text-stone-600" style={MONO}>{g.items.length}</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {g.items.map((ph, i) => (
                        <button key={i} onClick={() => setLightbox(ph.full)}
                          className="group relative rounded-lg overflow-hidden bg-white/[0.04] aspect-square ring-1 ring-white/[0.06] hover:ring-amber-500/70 transition-all">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={ph.thumb} alt="Progress photo" loading="lazy"
                            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.04]" />
                        </button>
                      ))}
                    </div>
                  </section>
                ));
              })()}
              <p className="text-center text-[11px] text-stone-600" style={MONO}>Photos posted by our crew from your job site.</p>
            </div>
          )
        )}

        {/* ---------------- FINANCIALS ---------------- */}
        {tab === "financials" && f && (
          <div className="space-y-4">
            {/* contract hero card */}
            <section className="pc-rise rounded-2xl border border-amber-500/25 bg-gradient-to-b from-amber-500/[0.07] to-transparent p-6 relative overflow-hidden" style={{ animationDelay: "0ms" }}>
              <div className="absolute inset-0 opacity-50" style={{ background: "radial-gradient(90% 70% at 100% 0%, rgba(217,119,6,.15), transparent 60%)" }} />
              <div className="relative">
                <p className="text-[10px] tracking-[0.34em] uppercase text-stone-500" style={MONO}>Contract Total</p>
                <p style={MONO} className="text-[2.6rem] leading-none mt-2 font-medium text-stone-100">{fmt(f.adjusted_contract || f.contract_value)}</p>
                {f.change_order_revenue !== 0 && (
                  <p className="text-xs text-stone-400 mt-2">includes <span style={MONO}>{fmt(f.change_order_revenue)}</span> in approved changes ({f.change_order_count})</p>
                )}
                <div className="mt-6 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-amber-700 to-amber-400 shadow-[0_0_12px_rgba(245,158,11,.5)]" style={{ width: `${paidPct}%`, animation: "pcGrow 1.1s cubic-bezier(.2,.7,.2,1) .3s both", transformOrigin: "left" }} />
                </div>
                <div className="mt-3.5 flex justify-between">
                  <div>
                    <span className="text-[9px] tracking-[0.22em] uppercase text-stone-500 block" style={MONO}>Paid to date</span>
                    <span style={MONO} className="text-lg text-emerald-400">{fmt(f.total_payments_received)}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-[9px] tracking-[0.22em] uppercase text-stone-500 block" style={MONO}>Balance remaining</span>
                    <span style={MONO} className="text-lg text-stone-200">{fmt(f.outstanding_receivable)}</span>
                  </div>
                </div>
              </div>
            </section>

            {/* payments */}
            <Card delay={80} title="Payments Received">
              {data.payments.length === 0 ? <p className="text-sm text-stone-500">No payments recorded yet.</p> : (
                <ul className="divide-y divide-white/[0.06]">
                  {data.payments.map((p) => (
                    <li key={p.id} className="flex items-center justify-between py-3">
                      <div>
                        <p className="text-[14px] capitalize text-stone-200">{p.description || p.payment_type}</p>
                        <p className="text-[11px] text-stone-500 mt-0.5" style={MONO}>{fmtDate(p.received_date)}{p.invoice_sent_number ? ` · Inv ${p.invoice_sent_number}` : ""}</p>
                      </div>
                      <span style={MONO} className="text-[15px] text-emerald-400">{fmt(p.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* change orders */}
            {data.change_orders.length > 0 && (
              <Card delay={140} title="Change Orders">
                <ul className="divide-y divide-white/[0.06]">
                  {data.change_orders.map((co) => (
                    <li key={co.id} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="text-[14px] truncate text-stone-200"><span style={MONO} className="text-stone-500">No.{co.change_order_number}</span> · {co.title}</p>
                        <p className="text-[11px] text-stone-500 capitalize mt-0.5">{co.signed ? "Approved" : co.status.replace(/_/g, " ")}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <span style={MONO} className="text-[15px] text-stone-200">{co.price_impact >= 0 ? "+" : "−"}{fmt(co.price_impact)}</span>
                        {!co.signed && co.approval_token && (
                          <a href={`/approve/${co.approval_token}`} className="block text-[11px] text-amber-400 hover:text-amber-300 font-medium mt-0.5">Review &amp; sign →</a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            <p className="text-center text-[13px] text-stone-500">Questions about billing? <a href={mailto} className="text-amber-400 hover:text-amber-300 underline underline-offset-4 decoration-amber-500/40">Email us</a>.</p>
          </div>
        )}
        {tab === "financials" && !f && <Empty>Financial details will appear here shortly.</Empty>}

        {/* ---------------- SELECTIONS ---------------- */}
        {tab === "selections" && (
          data.selections.length === 0 ? <Empty>No selections to make right now. We&apos;ll email you when there are.</Empty> : (
            <div className="space-y-4">
              {data.selections.map((s, i) => (
                <section key={s.id} className="pc-rise rounded-2xl bg-white/[0.03] border border-white/[0.07] p-5" style={{ animationDelay: `${i * 70}ms` }}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-[17px] font-semibold text-stone-100" style={DISPLAY}>{s.category}</h3>
                      {s.description && <p className="text-[13px] text-stone-400 mt-0.5">{s.description}</p>}
                    </div>
                    {s.status === "selected"
                      ? <span className="shrink-0 text-[9px] tracking-[0.16em] uppercase text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-full" style={MONO}>Selected</span>
                      : <span className="shrink-0 text-[9px] tracking-[0.16em] uppercase text-stone-950 bg-amber-500 px-2.5 py-1 rounded-full font-semibold" style={MONO}>Your choice</span>}
                  </div>
                  {s.allowance_amount != null && <p className="text-[11px] text-stone-500 mt-2" style={MONO}>Allowance · {fmt(s.allowance_amount)}</p>}

                  {s.status === "selected" ? (
                    <div className="mt-4 flex items-center gap-3 rounded-xl bg-emerald-500/[0.07] border border-emerald-500/20 px-4 py-3">
                      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-500">
                        <svg className="w-3.5 h-3.5 text-stone-950" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                      </span>
                      <span className="text-[15px] text-stone-100">{s.selected_value}</span>
                    </div>
                  ) : (
                    <div className="mt-4 grid gap-2">
                      {s.options.length === 0 && <p className="text-sm text-stone-500">Options coming soon — we&apos;re putting them together.</p>}
                      {s.options.map((opt) => {
                        const busy = picking === s.id + opt.id;
                        return (
                          <button key={opt.id} disabled={!!picking} onClick={() => pick(s.id, opt.id)}
                            className="group text-left rounded-xl border border-white/[0.08] hover:border-amber-500/60 bg-white/[0.02] hover:bg-amber-500/[0.05] p-3.5 flex items-center gap-3.5 transition-all disabled:opacity-50">
                            <span className="shrink-0 w-12 h-12 rounded-lg overflow-hidden flex items-center justify-center bg-white/[0.05] text-stone-500" style={MONO}>
                              {opt.image_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={opt.image_url} alt={opt.label} className="w-full h-full object-cover" />
                              ) : <span className="text-lg">{opt.label.charAt(0)}</span>}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-[14px] font-medium text-stone-200">{opt.label}</span>
                              {opt.description && <span className="block text-[12px] text-stone-500 mt-0.5">{opt.description}</span>}
                            </span>
                            <span className="shrink-0 text-right">
                              {opt.price_delta != null && opt.price_delta !== 0 && (
                                <span style={MONO} className={`block text-[13px] ${opt.price_delta > 0 ? "text-stone-300" : "text-emerald-400"}`}>{opt.price_delta > 0 ? "+" : "−"}{fmt(opt.price_delta)}</span>
                              )}
                              <span className="text-[10px] tracking-[0.14em] uppercase text-amber-500 group-hover:text-amber-400" style={MONO}>{busy ? "Saving…" : "Choose"}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>
              ))}
            </div>
          )
        )}
      </main>

      {/* ---------------- LIGHTBOX ---------------- */}
      {lightbox && (
        <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="Progress photo" className="max-w-full max-h-full rounded-lg" />
          <button className="absolute top-4 right-4 text-stone-300 hover:text-white text-[10px] tracking-[0.3em] uppercase" style={MONO} onClick={() => setLightbox(null)}>Close</button>
        </div>
      )}

      {/* ---------------- FOOTER ---------------- */}
      <footer className="max-w-2xl mx-auto px-5 pb-12 pt-3 text-center">
        <a href={mailto} className="inline-flex items-center gap-2.5 px-6 py-3 rounded-full bg-amber-500 hover:bg-amber-400 text-stone-950 text-sm font-semibold tracking-wide transition-colors shadow-[0_0_24px_rgba(245,158,11,.25)]">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
          Contact Penney Construction
        </a>
        <p className="mt-5 text-[10px] tracking-[0.24em] uppercase text-stone-600" style={MONO}>North Shore, MA · {CONTACT_PHONE}</p>
      </footer>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen flex items-center justify-center bg-[#0b0a08]">{children}</div>;
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-white/[0.09] bg-white/[0.02] p-10 text-center text-sm text-stone-500">{children}</div>;
}
function Card({ title, delay, children }: { title: string; delay: number; children: React.ReactNode }) {
  return (
    <section className="pc-rise rounded-2xl bg-white/[0.03] border border-white/[0.07] p-5" style={{ animationDelay: `${delay}ms` }}>
      <p className="text-[10px] tracking-[0.3em] uppercase text-stone-500 mb-3" style={MONO}>{title}</p>
      {children}
    </section>
  );
}
