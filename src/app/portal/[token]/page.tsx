"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";

const CONTACT_EMAIL = "jbetancur@penneyconstructioninc.com";
const CONTACT_PHONE = "978-621-4387";

// Refined architectural-editorial palette — warm charcoal + cream + terracotta amber.
const SERIF = { fontFamily: "var(--font-playfair), Georgia, serif" } as const;
const GARA = { fontFamily: "var(--font-cormorant), Georgia, serif" } as const;

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
interface Phase { id: string; name: string; description: string | null; start_date: string | null; end_date: string | null; status: string; color: string | null; firm: boolean }
interface ChangeOrder { id: string; change_order_number: number; title: string; description: string | null; status: string; price_impact: number; signed: boolean; approval_token: string | null }
interface Payment { id: string; payment_type: string; description: string | null; amount: number; received_date: string | null; invoice_sent_number: string | null }
interface Financials {
  contract_value: number; adjusted_contract: number; total_payments_received: number;
  deposit_received: number; draws_received: number; final_received: number;
  outstanding_receivable: number; change_order_count: number; change_order_revenue: number;
}
interface PortalData {
  client_name: string | null;
  project: { name: string; project_number: string; address: string; status: string };
  financials: Financials | null;
  schedule: Phase[]; payments: Payment[]; change_orders: ChangeOrder[]; selections: Selection[];
}

type Tab = "schedule" | "financials" | "selections";

export default function ClientPortalPage() {
  const { token } = useParams();
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("schedule");
  const [picking, setPicking] = useState<string | null>(null);

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

  if (loading) return <Shell><div className="animate-pulse text-[#a89c8a] tracking-[0.3em] text-xs uppercase">Loading</div></Shell>;
  if (error) return <Shell><p className="text-[#9a3412] text-center px-8 max-w-sm" style={SERIF}>{error}</p></Shell>;
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
        {/* warm amber glow + grain */}
        <div className="absolute inset-0 opacity-70" style={{ background: "radial-gradient(120% 80% at 85% -10%, rgba(217,119,6,.22), transparent 55%)" }} />
        <div className="absolute inset-0 opacity-[0.06]" style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")" }} />
        <div className="relative max-w-2xl mx-auto px-6 pt-12 pb-8">
          <div className="pc-rise flex items-center gap-2.5" style={{ animationDelay: "0ms" }}>
            <span className="h-px w-6 bg-[#d97706]" />
            <p className="text-[10px] tracking-[0.34em] uppercase text-[#d9a066]">Penney Construction</p>
          </div>
          <h1 className="pc-rise mt-4 text-[2.6rem] leading-[1.05] font-medium" style={{ ...SERIF, animationDelay: "70ms" }}>{data.project.name}</h1>
          <p className="pc-rise mt-2 text-[#b6ab9a] text-sm" style={{ animationDelay: "120ms" }}>{data.project.address || data.project.project_number}</p>

          {/* build progress */}
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
          {data.client_name && <p className="pc-rise mt-7 text-[13px] text-[#8f8475]" style={{ animationDelay: "240ms" }}>Prepared for <span className="text-[#cbbfac]">{data.client_name}</span></p>}
        </div>
      </header>

      {/* ---------------- TABS ---------------- */}
      <nav className="sticky top-0 z-20 bg-[#f4efe6]/92 backdrop-blur border-b border-[#e3d9c8]">
        <div className="max-w-2xl mx-auto flex px-3">
          {([["schedule", "Schedule"], ["financials", "Financials"], ["selections", "Selections"]] as [Tab, string][]).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className="relative flex-1 py-4 text-[13px] tracking-wide transition-colors"
              style={{ color: tab === key ? "#2b2620" : "#a99e8c" }}>
              <span className="inline-flex items-center gap-1.5">
                {label}
                {key === "selections" && pendingCount > 0 && (
                  <span className="inline-flex items-center justify-center text-[10px] font-semibold text-white bg-[#d97706] rounded-full min-w-[16px] h-4 px-1">{pendingCount}</span>
                )}
              </span>
              {tab === key && <span className="absolute left-1/2 -translate-x-1/2 bottom-0 h-[2px] w-8 bg-[#d97706] rounded-full" />}
            </button>
          ))}
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-5 py-7">
        {/* ---------------- SCHEDULE ---------------- */}
        {tab === "schedule" && (
          total === 0 ? <Empty>Your project timeline will appear here once it&apos;s scheduled.</Empty> : (
            <>
            {/* status summary band */}
            <div className="pc-rise flex items-center justify-between gap-4 rounded-xl bg-[#fffdf8] border border-[#ece1cf] px-4 py-3">
              <div className="flex items-center gap-2.5">
                <span className={`w-2 h-2 rounded-full ${done === total || current ? "bg-[#6f8a4f]" : "bg-[#cdbfa9]"}`} />
                <span className="text-[13px] text-[#5d6b4a]">{statusLabel} · Phase {phasePos} of {total}</span>
              </div>
              <div className="text-right">
                <span className="block text-[10px] tracking-[0.14em] uppercase text-[#a99e8c]">Est. completion</span>
                <span style={GARA} className="text-base text-[#2b2620]">{monthBand(data.schedule[total - 1]?.end_date)}</span>
              </div>
            </div>

            <p className="text-xs text-[#a99e8c] mt-3 mb-1 leading-relaxed px-0.5">
              <span className="text-[#5d6b4a] font-medium">Confirmed</span> dates are locked with our trades. <span className="italic">Estimated</span> dates shift as work progresses — they&apos;ll firm up as we get closer.
            </p>

            <div className="relative">
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

        {/* ---------------- FINANCIALS ---------------- */}
        {tab === "financials" && f && (
          <div className="space-y-5">
            {/* contract hero card */}
            <section className="pc-rise rounded-2xl bg-[#1c1815] text-[#f4efe6] p-7 relative overflow-hidden" style={{ animationDelay: "0ms" }}>
              <div className="absolute inset-0 opacity-60" style={{ background: "radial-gradient(100% 70% at 100% 0%, rgba(217,119,6,.18), transparent 60%)" }} />
              <div className="relative">
                <p className="text-[10px] tracking-[0.3em] uppercase text-[#8f8475]">Contract Total</p>
                <p style={GARA} className="text-5xl leading-none mt-1.5">{fmt(f.adjusted_contract || f.contract_value)}</p>
                {f.change_order_revenue !== 0 && (
                  <p className="text-xs text-[#b6ab9a] mt-2">includes {fmt(f.change_order_revenue)} in approved changes ({f.change_order_count})</p>
                )}
                <div className="mt-6 h-[6px] rounded-full bg-[#332c26] overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-[#b45309] to-[#f0a04b]" style={{ width: `${paidPct}%`, animation: "pcGrow 1.1s cubic-bezier(.2,.7,.2,1) .3s both", transformOrigin: "left" }} />
                </div>
                <div className="mt-3 flex justify-between text-sm">
                  <div><span className="text-[#8f8475] text-xs block">Paid to date</span><span style={GARA} className="text-xl text-[#f0c89b]">{fmt(f.total_payments_received)}</span></div>
                  <div className="text-right"><span className="text-[#8f8475] text-xs block">Balance remaining</span><span style={GARA} className="text-xl">{fmt(f.outstanding_receivable)}</span></div>
                </div>
              </div>
            </section>

            {/* payments */}
            <Card delay={80} title="Payments Received">
              {data.payments.length === 0 ? <p className="text-sm text-[#a99e8c]">No payments recorded yet.</p> : (
                <ul className="divide-y divide-[#ece3d4]">
                  {data.payments.map((p) => (
                    <li key={p.id} className="flex items-center justify-between py-3">
                      <div>
                        <p className="text-[15px] capitalize" style={SERIF}>{p.description || p.payment_type}</p>
                        <p className="text-xs text-[#a99e8c]" style={GARA}>{fmtDate(p.received_date)}{p.invoice_sent_number ? ` · Inv ${p.invoice_sent_number}` : ""}</p>
                      </div>
                      <span style={GARA} className="text-lg text-[#5d6b4a]">{fmt(p.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* change orders */}
            {data.change_orders.length > 0 && (
              <Card delay={140} title="Change Orders">
                <ul className="divide-y divide-[#ece3d4]">
                  {data.change_orders.map((co) => (
                    <li key={co.id} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="text-[15px] truncate" style={SERIF}>No.{co.change_order_number} · {co.title}</p>
                        <p className="text-xs text-[#a99e8c] capitalize">{co.signed ? "Approved" : co.status.replace(/_/g, " ")}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <span style={GARA} className="text-lg">{co.price_impact >= 0 ? "+" : "−"}{fmt(co.price_impact)}</span>
                        {!co.signed && co.approval_token && (
                          <a href={`/approve/${co.approval_token}`} className="block text-xs text-[#b45309] font-medium mt-0.5">Review &amp; sign →</a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            <p className="text-center text-sm text-[#a99e8c]">Questions about billing? <a href={mailto} className="text-[#b45309] underline underline-offset-2">Email us</a>.</p>
          </div>
        )}
        {tab === "financials" && !f && <Empty>Financial details will appear here shortly.</Empty>}

        {/* ---------------- SELECTIONS ---------------- */}
        {tab === "selections" && (
          data.selections.length === 0 ? <Empty>No selections to make right now. We&apos;ll email you when there are.</Empty> : (
            <div className="space-y-5">
              {data.selections.map((s, i) => (
                <section key={s.id} className="pc-rise rounded-2xl bg-[#fffdf8] border border-[#e8decd] shadow-[0_1px_0_rgba(0,0,0,0.02)] p-6" style={{ animationDelay: `${i * 70}ms` }}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-xl" style={SERIF}>{s.category}</h3>
                      {s.description && <p className="text-sm text-[#7c7264] mt-0.5">{s.description}</p>}
                    </div>
                    {s.status === "selected"
                      ? <span className="shrink-0 text-[10px] tracking-[0.14em] uppercase text-[#5d6b4a] bg-[#e9efdf] px-2.5 py-1 rounded-full">Selected</span>
                      : <span className="shrink-0 text-[10px] tracking-[0.14em] uppercase text-[#b45309] bg-[#f6e7d0] px-2.5 py-1 rounded-full">Your choice</span>}
                  </div>
                  {s.allowance_amount != null && <p className="text-xs text-[#a99e8c] mt-2" style={GARA}>Allowance · {fmt(s.allowance_amount)}</p>}

                  {s.status === "selected" ? (
                    <div className="mt-4 flex items-center gap-3 rounded-xl bg-[#f3f6ec] px-4 py-3">
                      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-[#6b7a52]">
                        <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                      </span>
                      <span className="text-lg italic" style={GARA}>{s.selected_value}</span>
                    </div>
                  ) : (
                    <div className="mt-4 grid gap-2.5">
                      {s.options.length === 0 && <p className="text-sm text-[#a99e8c]">Options coming soon — we&apos;re putting them together.</p>}
                      {s.options.map((opt) => {
                        const busy = picking === s.id + opt.id;
                        return (
                          <button key={opt.id} disabled={!!picking} onClick={() => pick(s.id, opt.id)}
                            className="group text-left rounded-xl border border-[#e8decd] hover:border-[#d97706] hover:bg-[#fdf6ea] p-3.5 flex items-center gap-3.5 transition-all disabled:opacity-50 hover:shadow-sm">
                            <span className="shrink-0 w-12 h-12 rounded-lg overflow-hidden flex items-center justify-center bg-[#efe7d8] text-[#b09a78]" style={GARA}>
                              {opt.image_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={opt.image_url} alt={opt.label} className="w-full h-full object-cover" />
                              ) : <span className="text-lg">{opt.label.charAt(0)}</span>}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-[15px]" style={SERIF}>{opt.label}</span>
                              {opt.description && <span className="block text-xs text-[#8c8275] mt-0.5">{opt.description}</span>}
                            </span>
                            <span className="shrink-0 text-right">
                              {opt.price_delta != null && opt.price_delta !== 0 && (
                                <span style={GARA} className={`block text-base ${opt.price_delta > 0 ? "text-[#2b2620]" : "text-[#5d6b4a]"}`}>{opt.price_delta > 0 ? "+" : "−"}{fmt(opt.price_delta)}</span>
                              )}
                              <span className="text-[11px] tracking-[0.12em] uppercase text-[#b45309] group-hover:text-[#d97706]">{busy ? "Saving…" : "Choose"}</span>
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

      {/* ---------------- FOOTER ---------------- */}
      <footer className="max-w-2xl mx-auto px-5 pb-12 pt-2 text-center">
        <a href={mailto} className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#1c1815] text-[#f4efe6] text-sm tracking-wide hover:bg-[#2b2620] transition-colors">
          <svg className="w-4 h-4 text-[#d9a066]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
          Contact Penney Construction
        </a>
        <p className="mt-5 text-[11px] tracking-[0.16em] uppercase text-[#a99e8c]">North Shore, MA · {CONTACT_PHONE}</p>
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
function Card({ title, delay, children }: { title: string; delay: number; children: React.ReactNode }) {
  return (
    <section className="pc-rise rounded-2xl bg-[#fffdf8] border border-[#e8decd] p-6" style={{ animationDelay: `${delay}ms` }}>
      <p className="text-[10px] tracking-[0.26em] uppercase text-[#a99e8c] mb-3">{title}</p>
      {children}
    </section>
  );
}
