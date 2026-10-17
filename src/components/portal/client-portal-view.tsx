"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Camera, Check, ChevronRight, FileText } from "lucide-react";
import { formatMoney } from "@/lib/money";
import { scheduleProgress } from "@/lib/schedule/progress";
import { deriveCurrentScheduleActivity } from "@/lib/schedule/health";
import type {
  PortalData,
  PortalDecision,
  PortalDesignCover,
  PortalDocument,
  PortalDocumentGroup,
  PortalPhoto,
  PortalSelectionItem,
  PortalSelectionSheet,
  SelectionItemStatus,
} from "@/lib/portal/types";
import { portalFont } from "./portal-font";

const CONTACT_EMAIL = "jbetancur@penneyconstructioninc.com";
const CONTACT_PHONE = "978-621-4387";

// Light, phone-first portal in the same palette as the client packages
// (selection sheets, design presentations): warm paper, dark ink, terracotta.
// Content is visible immediately — no reveal-on-scroll or fade-in effects.
const STATUS: Record<SelectionItemStatus, { label: string; color: string }> = {
  selected: { label: "Selected", color: "#2F6B4F" },
  proposed: { label: "Proposed", color: "#606B65" },
  pending: { label: "Pending", color: "#B4471F" },
  reused: { label: "Reused", color: "#2F5D7C" },
  ordered: { label: "Ordered", color: "#7A5A1E" },
  installed: { label: "Installed", color: "#2F6B4F" },
};

const DOC_GROUPS: { key: PortalDocumentGroup; label: string }[] = [
  { key: "design", label: "Design" },
  { key: "selections", label: "Selections" },
  { key: "contract", label: "Contract" },
  { key: "change_order", label: "Change orders" },
  { key: "invoice", label: "Invoices" },
  { key: "permit", label: "Permits" },
  { key: "other", label: "Other" },
];

type Tab = "home" | "schedule" | "selections" | "documents" | "payments" | "photos";
const TABS: [Tab, string][] = [
  ["home", "Home"],
  ["schedule", "Schedule"],
  ["selections", "Selections"],
  ["documents", "Documents"],
  ["payments", "Payments"],
  ["photos", "Photos"],
];

// Always to the cent — these figures mirror the PDFs and invoices.
const fmt = (v: number) => formatMoney(v, { cents: "always" });
const parseDay = (d: string) => new Date(d + (d.length === 10 ? "T00:00:00" : ""));
const fmtDate = (d: string | null) =>
  d ? parseDay(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "TBD";
const fmtShort = (d: string | null) =>
  d ? parseDay(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "TBD";
// Estimated phases get "week of" granularity, snapped to Monday.
const weekOf = (d: string | null) => {
  if (!d) return "Date to be set";
  const dt = parseDay(d);
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return `Week of ${dt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
};

const STATUS_WORDS: Record<string, string> = {
  lead: "Planning",
  estimating: "Planning",
  proposal_sent: "Planning",
  contracted: "Getting ready",
  in_progress: "Under construction",
  audit: "Wrapping up",
  completed: "Complete",
};

type ActionKind = "phase" | "item" | "decision";

// The client's own taps (mark complete, approve, remove, done, not needed,
// undo). Saved through /api/portal/action; disabled in the staff preview.
function useClientAction(token: string | undefined, preview: boolean, onReload?: () => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const enabled = !!token && !preview;
  async function act(kind: ActionKind, id: string, action: string) {
    if (!enabled || busy) return;
    setBusy(`${kind}:${id}`);
    try {
      const res = await fetch("/api/portal/action", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, kind, id, action }),
      });
      const d = await res.json();
      if (d.success) onReload?.();
      else alert(d.error || "Could not save. Please try again.");
    } catch {
      alert("Could not save. Please try again.");
    }
    setBusy(null);
  }
  return { act, busy, enabled };
}
type ClientAction = ReturnType<typeof useClientAction>;

const todayISO = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const phaseDone = (p: { status: string | null }) => p.status === "completed";
const itemStatus = (i: PortalSelectionItem): SelectionItemStatus => (i.client_action === "approved" ? "selected" : i.status);

export interface ClientPortalViewProps {
  data: PortalData;
  /** Client mode: the portal token (enables picking). Absent in preview. */
  token?: string;
  onReload?: () => void;
}

export function ClientPortalView({ data, token, onReload }: ClientPortalViewProps) {
  const preview = data.mode === "preview";
  const [tab, setTab] = useState<Tab>("home");
  const [photoIndex, setPhotoIndex] = useState<number | null>(null);
  const action = useClientAction(token, preview, onReload);

  // Deep links: /portal/<token>#selections opens that tab.
  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.replace("#", "") as Tab;
      if (TABS.some(([k]) => k === h)) setTab(h);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);
  function go(t: Tab) {
    setTab(t);
    try { history.replaceState(null, "", `#${t}`); } catch { /* ignore */ }
    window.scrollTo({ top: 0 });
  }

  const subject = encodeURIComponent(`${data.project.project_number} — ${data.project.name}`);
  const mailto = `mailto:${CONTACT_EMAIL}?subject=${subject}`;

  const { total, percent: pct, pendingClientReports } = scheduleProgress(data.schedule);
  const today = todayISO();
  const activity = deriveCurrentScheduleActivity(data.schedule, today, data.project.status);
  const current = activity.current;
  const statusWord = STATUS_WORDS[data.project.status] ?? "In progress";

  const visibleDecisions = data.selections.filter((s) => s.client_visible !== false);
  const pendingDecisions = visibleDecisions.filter((s) => s.status === "pending" && !s.client_dismissed_at).length;

  return (
    <div className={`pc-portal ${portalFont.className} min-h-screen`}>
      <style>{`
        .pc-portal { --paper:#F7F5F1; --card:#FFFFFF; --ink:#252D2B; --muted:#606B65; --line:#E4E0D8; --accent:#C66638; --accent-dark:#9E4E28; background:var(--paper); color:var(--ink); -webkit-text-size-adjust:100%; }
        .pc-portal .card { background:var(--card); border:1px solid var(--line); border-radius:16px; }
        .pc-portal .label { font-size:12px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); }
        .pc-portal .btn { display:inline-flex; align-items:center; justify-content:center; gap:8px; min-height:44px; padding:0 18px; border-radius:12px; font-weight:700; font-size:15px; }
        .pc-portal .btn-primary { background:var(--accent); color:#fff; }
        .pc-portal .btn-primary:active { background:var(--accent-dark); }
        .pc-portal .btn-ghost { background:#fff; color:var(--ink); border:1px solid var(--line); }
        .pc-portal .tabs::-webkit-scrollbar { display:none; }
        .pc-portal .clamp3 { display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
      `}</style>

      {preview && <PreviewBanner data={data} />}

      {/* ---------------- HEADER ---------------- */}
      <div className="h-1 bg-[var(--accent)]" />
      <header className="bg-[var(--ink)] text-white">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <span className="flex h-11 w-[68px] shrink-0 items-center justify-center rounded-lg bg-white px-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-email.jpg" alt="Penney Construction" className="max-h-9 w-auto" />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-white/70">Penney Construction</p>
            <p className="text-[15px] font-bold leading-tight">Your project portal</p>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-2xl px-4 pb-5 pt-6">
        <h1 className="text-[26px] font-extrabold leading-[1.1] tracking-[-0.01em]">{data.project.name}</h1>
        <p className="mt-1.5 text-[15px] text-[var(--muted)]">{data.project.address || data.project.project_number}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-[var(--ink)] px-3 py-1 text-[13px] font-bold text-white">{statusWord}</span>
          {data.client_name && <span className="text-[14px] text-[var(--muted)]">for {data.client_name}</span>}
        </div>
        {total > 0 && (
          <div className="mt-4">
            <div className="mb-1.5 flex items-baseline justify-between text-[14px]">
              <span className="font-semibold">{current ? current.name : pct === 100 ? "Complete" : "Schedule"}</span>
              <span className="font-bold">{pct}% verified</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--line)]">
              <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
            </div>
            {pendingClientReports > 0 && <p className="mt-1 text-[13px] text-[var(--muted)]">{pendingClientReports} completion report{pendingClientReports === 1 ? "" : "s"} awaiting team verification</p>}
          </div>
        )}
      </section>

      {/* ---------------- TABS ---------------- */}
      <nav className="sticky top-0 z-20 border-y border-[var(--line)] bg-[var(--paper)]/95 backdrop-blur">
        <div className="tabs mx-auto flex max-w-2xl gap-1.5 overflow-x-auto px-3 py-2" style={{ scrollbarWidth: "none" }}>
          {TABS.map(([key, label]) => {
            const badge = key === "home" ? data.needed.length : key === "selections" ? pendingDecisions : 0;
            const active = tab === key;
            return (
              <button key={key} onClick={() => go(key)}
                className={`flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-full px-4 text-[15px] font-bold ${active ? "bg-[var(--ink)] text-white" : "text-[var(--muted)]"}`}>
                {label}
                {badge > 0 && (
                  <span className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[12px] ${active ? "bg-white text-[var(--ink)]" : "bg-[var(--accent)] text-white"}`}>{badge}</span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      <main className="mx-auto max-w-2xl space-y-4 px-4 py-5">
        {tab === "home" && <HomeTab data={data} go={go} upcoming={activity.upcoming.slice(0, 3)} today={today} />}
        {tab === "schedule" && <ScheduleTab data={data} action={action} />}
        {tab === "selections" && (
          <SelectionsTab data={data} decisions={preview ? data.selections : visibleDecisions} token={token} onReload={onReload} action={action} />
        )}
        {tab === "documents" && <DocumentsTab docs={data.documents} />}
        {tab === "payments" && <PaymentsTab data={data} mailto={mailto} />}
        {tab === "photos" && <PhotosTab photos={data.photos} onOpen={setPhotoIndex} />}
      </main>

      {photoIndex != null && data.photos[photoIndex] && (
        <PhotoViewer photos={data.photos} index={photoIndex} onIndex={setPhotoIndex} onClose={() => setPhotoIndex(null)} />
      )}

      <footer className="mx-auto max-w-2xl px-4 pb-12 pt-4 text-center">
        <a href={mailto} className="btn btn-primary w-full max-w-sm">Email Penney Construction</a>
        <p className="mt-4 text-[14px] text-[var(--muted)]">
          <a href={`tel:${CONTACT_PHONE.replace(/-/g, "")}`} className="font-semibold text-[var(--ink)]">{CONTACT_PHONE}</a> · North Shore, MA
        </p>
      </footer>
    </div>
  );
}

// ─────────────────────────────── Preview banner
function PreviewBanner({ data }: { data: PortalData }) {
  const p = data.portal;
  const linkState = !p?.exists
    ? "No portal link yet"
    : !p.enabled
      ? "Link turned off"
      : `Link live · ${p.view_count} client view${p.view_count === 1 ? "" : "s"}${p.link_sent_at ? ` · sent ${fmtShort(p.link_sent_at.slice(0, 10))}` : " · not sent"}`;
  return (
    <div className="bg-[#7A2E12] px-4 py-2.5 text-white">
      <div className="mx-auto max-w-2xl">
        <p className="text-[14px] font-extrabold">Staff preview</p>
        <p className="text-[13px] leading-snug text-white/85">
          This is the client&apos;s view. Anything marked DRAFT or Hidden is not visible to them. {linkState}.
        </p>
      </div>
    </div>
  );
}

function Draft({ children = "Draft · not visible to client" }: { children?: React.ReactNode }) {
  return <span className="inline-block rounded-md bg-[#7A2E12] px-2 py-0.5 text-[12px] font-bold text-white">{children}</span>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="card p-6 text-center text-[15px] text-[var(--muted)]">{children}</div>;
}

// ─────────────────────────────── Home
function HomeTab({ data, go, upcoming, today }: { data: PortalData; go: (t: Tab) => void; upcoming: PortalData["schedule"]; today: string }) {
  const t = data.today_on_site;
  const showToday = !!t && (t.live_count > 0 || t.tasks.length > 0 || (t.tomorrow?.tasks.length ?? 0) > 0);
  return (
    <>
      {data.design_cover && <DesignHero cover={data.design_cover} />}

      {data.needed.length === 0 ? (
        <section className="card flex items-center gap-3 p-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#EEF5F0] text-[#2F6B4F]">
            <Check className="h-5 w-5" strokeWidth={3} aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-[16px] font-bold">You&apos;re all caught up</p>
            <p className="text-[14px] leading-snug text-[var(--muted)]">Nothing needed from you right now. We&apos;ll email you when we need something.</p>
          </div>
        </section>
      ) : (
        <section className="card border-l-4 border-l-[var(--accent)] p-4">
          <p className="label">Needed from you</p>
          <ul className="mt-2 divide-y divide-[var(--line)]">
            {data.needed.map((n, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-[16px] font-bold">{n.title}</p>
                  {n.detail && <p className="clamp3 mt-0.5 text-[14px] text-[var(--muted)]">{n.detail}</p>}
                </div>
                {n.url ? (
                  <a href={n.url} target="_blank" rel="noreferrer" className="btn btn-primary shrink-0">Open</a>
                ) : n.tab ? (
                  <button onClick={() => go(n.tab!)} className="btn btn-primary shrink-0">Choose</button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      {showToday && t && (
        <section className="card border-l-4 border-l-[var(--accent)] p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="label">Today at your home</p>
            {t.live_count > 0 && <span className="text-[13px] font-bold text-[#2F6B4F]">● On site now</span>}
          </div>
          <p className="mt-1.5 text-[19px] font-extrabold">
            {t.live_count > 0
              ? `${t.live_count} crew member${t.live_count === 1 ? "" : "s"} at your home`
              : t.planned_count > 0
                ? `${t.planned_count} crew member${t.planned_count === 1 ? "" : "s"} scheduled today`
                : "Today's plan"}
          </p>
          {t.tasks.length > 0 && (
            <ul className="mt-2 space-y-2">
              {t.tasks.map((task, i) => (
                <li key={i}>
                  <p className="text-[16px] font-semibold">{task.name}</p>
                  {task.description && <p className="text-[14px] text-[var(--muted)]">{task.description}</p>}
                </li>
              ))}
            </ul>
          )}
          {(t.tomorrow?.tasks.length ?? 0) > 0 && (
            <div className="mt-3 border-t border-[var(--line)] pt-3">
              <p className="label">Tomorrow</p>
              <ul className="mt-1.5 space-y-1.5">
                {t.tomorrow!.tasks.map((task, i) => (
                  <li key={i} className="text-[15px] font-semibold">{task.name}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section className="card p-4">
        <div className="flex items-center justify-between">
          <p className="label">Up next</p>
          {data.schedule.length > 0 && <button onClick={() => go("schedule")} className="text-[14px] font-bold text-[var(--accent-dark)]">Full schedule</button>}
        </div>
        {upcoming.length === 0 ? (
          <p className="mt-2 text-[15px] text-[var(--muted)]">{data.project.status === "completed" ? "Your project is complete." : data.schedule.length === 0 ? "Your schedule will appear here once your start date is set." : data.schedule.every(phaseDone) ? "All scheduled work is complete." : "The team is reviewing the next schedule update."}</p>
        ) : (
          <ul className="mt-1 divide-y divide-[var(--line)]">
            {upcoming.map((p) => {
              const inProgress = p.status === "in_progress" && !!p.start_date && p.start_date <= today;
              return (
                <li key={p.id} className="flex items-center gap-3 py-3">
                  <DateTile date={p.start_date} week={!p.firm && !inProgress} active={inProgress} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[16px] font-semibold leading-snug">{p.name}</span>
                    <span className="block text-[13px] text-[var(--muted)]">
                      {inProgress ? "In progress" : p.firm ? `Confirmed · ${fmtShort(p.start_date)}` : weekOf(p.start_date)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <SelectionsCard data={data} onOpen={() => go("selections")} />
      <PaymentsCard data={data} onOpen={() => go("payments")} />

      <div className="grid grid-cols-2 gap-3">
        <DocumentsTile docs={data.documents} onOpen={() => go("documents")} />
        <PhotosTile photos={data.photos} onOpen={() => go("photos")} />
      </div>
    </>
  );
}

// The project's design rendering, laid out like the cover of the client
// design presentation: the picture, then the dark panel with the title.
function DesignHero({ cover }: { cover: PortalDesignCover }) {
  return (
    <section className="card overflow-hidden sm:grid sm:grid-cols-[minmax(0,5fr)_minmax(0,8fr)]">
      <a href={cover.url} target="_blank" rel="noreferrer" className="block bg-[var(--line)] sm:order-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={cover.image_url} alt={`${cover.title} rendering`} className="aspect-[3/2] h-full w-full object-cover" />
      </a>
      <div className="flex flex-col justify-between gap-4 bg-[var(--ink)] p-4 text-white sm:order-1 sm:p-5">
        <div>
          {cover.staged && <p className="mb-2"><Draft /></p>}
          <p className="text-[12px] font-bold uppercase tracking-[.08em] text-[#E39A72]">Your design</p>
          <h2 className="mt-1 text-[21px] font-extrabold leading-tight">{cover.title}</h2>
          {cover.subtitle && <p className="mt-1 text-[14px] text-white/75">{cover.subtitle}</p>}
          <p className="mt-2 text-[13px] leading-snug text-white/65">Design illustration. The finishes you choose are tracked in Selections.</p>
        </div>
        <a href={cover.url} target="_blank" rel="noreferrer"
          className="btn w-full bg-white text-[var(--ink)] active:bg-[var(--paper)]">
          Open presentation <ArrowUpRight className="h-4 w-4" strokeWidth={2.5} aria-hidden />
        </a>
      </div>
    </section>
  );
}

// Calendar tile for Up next. Estimated phases show their week's Monday.
function DateTile({ date, week, active }: { date: string | null; week: boolean; active: boolean }) {
  const d = date ? parseDay(date) : null;
  if (d && week) d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return (
    <span className={`flex h-[52px] w-[50px] shrink-0 flex-col items-center justify-center rounded-xl border ${active ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-[var(--line)] bg-[var(--paper)]"}`}>
      {d ? (
        <>
          <span className={`text-[11px] font-bold uppercase leading-none tracking-[.06em] ${active ? "text-white/85" : "text-[var(--accent-dark)]"}`}>
            {d.toLocaleDateString("en-US", { month: "short" })}
          </span>
          <span className="mt-0.5 text-[20px] font-extrabold leading-none">{d.getDate()}</span>
        </>
      ) : <span className="text-[12px] font-bold text-[var(--muted)]">TBD</span>}
    </span>
  );
}

function CardHead({ title, action }: { title: string; action: string }) {
  return (
    <span className="flex items-center justify-between gap-3">
      <span className="label">{title}</span>
      <span className="inline-flex items-center text-[14px] font-bold text-[var(--accent-dark)]">
        {action}<ChevronRight className="h-4 w-4" strokeWidth={2.5} aria-hidden />
      </span>
    </span>
  );
}

const HOME_THUMBS = 8;

// Selections at a glance: the product photos from the current sheet and a
// bar split by status, in the same colors as the Selections tab.
function SelectionsCard({ data, onOpen }: { data: PortalData; onOpen: () => void }) {
  const sheet = data.selection_sheet;
  const decisions = data.selections.filter((s) => s.client_visible !== false);
  const items = sheet ? sheet.items.filter((i) => i.client_action !== "removed") : [];
  const counts = sheet ? countStatuses(sheet.items) : null;
  const withPhotos = items.filter((i) => i.image_url);
  const shown = withPhotos.slice(0, HOME_THUMBS);
  const more = withPhotos.length - shown.length;
  const order = Object.keys(STATUS) as SelectionItemStatus[];
  const title = sheet
    ? [sheet.title.replace(/^Fixture \+ Finish /, ""), sheet.revision].filter(Boolean).join(" ")
    : decisions.length ? `${decisions.length} decision${decisions.length === 1 ? "" : "s"}` : "None right now";

  return (
    <button onClick={onOpen} className="card block w-full p-4 text-left">
      <CardHead title="Selections" action="View all" />
      <span className="mt-1 block text-[19px] font-extrabold leading-tight">{title}</span>
      {sheet?.staged && <span className="mt-1.5 block"><Draft>Draft</Draft></span>}
      {!sheet && <span className="mt-1 block text-[14px] text-[var(--muted)]">{decisions.length ? "Open to see what we need you to choose." : "We'll email you when there's something to choose."}</span>}

      {shown.length > 0 && (
        <span className="mt-3 grid grid-cols-4 gap-2">
          {shown.map((it, i) => {
            const last = i === shown.length - 1 && more > 0;
            return (
              <span key={it.id} className="relative block aspect-square overflow-hidden rounded-xl border border-[var(--line)] bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={it.image_url!} alt={it.name} loading="lazy" className="h-full w-full object-contain p-1" />
                <span className="absolute left-1.5 top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white" style={{ background: STATUS[itemStatus(it)].color }} />
                {last && (
                  <span className="absolute inset-0 flex items-center justify-center bg-[rgba(37,45,43,0.72)] text-[16px] font-extrabold text-white">+{more}</span>
                )}
              </span>
            );
          })}
        </span>
      )}

      {counts && items.length > 0 && (
        <>
          <span className="mt-3 flex h-2 overflow-hidden rounded-full bg-[var(--line)]">
            {order.filter((k) => counts[k] > 0).map((k) => (
              <span key={k} className="h-full" style={{ width: `${(counts[k] / items.length) * 100}%`, background: STATUS[k].color }} />
            ))}
          </span>
          <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-[var(--muted)]">
            {order.filter((k) => counts[k] > 0).map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: STATUS[k].color }} />
                <span><b className="text-[var(--ink)]">{counts[k]}</b> {STATUS[k].label.toLowerCase()}</span>
              </span>
            ))}
          </span>
        </>
      )}
    </button>
  );
}

function PaymentsCard({ data, onOpen }: { data: PortalData; onOpen: () => void }) {
  const f = data.financials;
  if (!f) return null;
  const total = f.adjusted_contract || f.contract_value;
  const paidPct = total > 0 ? Math.min(100, Math.round((f.total_payments_received / total) * 100)) : 0;
  return (
    <button onClick={onOpen} className="card block w-full p-4 text-left">
      <CardHead title="Payments" action="Details" />
      <span className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-[22px] font-extrabold leading-tight">
          {fmt(f.total_payments_received)} <span className="text-[14px] font-semibold text-[var(--muted)]">paid</span>
        </span>
        <span className="text-[14px] text-[var(--muted)]">of {fmt(total)}</span>
      </span>
      <span className="mt-2.5 block h-2 overflow-hidden rounded-full bg-[var(--line)]">
        <span className="block h-full rounded-full bg-[#2F6B4F]" style={{ width: `${paidPct}%` }} />
      </span>
      <span className="mt-1.5 block text-[13px] text-[var(--muted)]">{paidPct}% of your contract paid</span>
    </button>
  );
}

function DocumentsTile({ docs, onOpen }: { docs: PortalDocument[]; onOpen: () => void }) {
  const groups = DOC_GROUPS.filter((g) => docs.some((d) => (d.group === "drawing" ? "design" : d.group) === g.key)).map((g) => g.label);
  return (
    <button onClick={onOpen} className="card flex min-h-[132px] flex-col items-start p-3.5 text-left">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--paper)] text-[var(--accent-dark)]">
        <FileText className="h-5 w-5" strokeWidth={2.25} aria-hidden />
      </span>
      <span className="label mt-2.5 block">Documents</span>
      <span className="mt-0.5 block text-[17px] font-extrabold leading-tight">{docs.length} file{docs.length === 1 ? "" : "s"}</span>
      {groups.length > 0 && <span className="mt-0.5 block text-[13px] leading-snug text-[var(--muted)]">{groups.join(" · ")}</span>}
    </button>
  );
}

function PhotosTile({ photos, onOpen }: { photos: PortalPhoto[]; onOpen: () => void }) {
  if (photos.length === 0) {
    return (
      <button onClick={onOpen} className="card flex min-h-[132px] flex-col items-start p-3.5 text-left">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--paper)] text-[var(--accent-dark)]">
          <Camera className="h-5 w-5" strokeWidth={2.25} aria-hidden />
        </span>
        <span className="label mt-2.5 block">Photos</span>
        <span className="mt-0.5 block text-[17px] font-extrabold leading-tight">None yet</span>
        <span className="mt-0.5 block text-[13px] leading-snug text-[var(--muted)]">Site photos appear once work starts</span>
      </button>
    );
  }
  return (
    <button onClick={onOpen} className="card relative block min-h-[132px] overflow-hidden text-left">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photos[0].thumb} alt="Latest progress photo" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-3.5 pt-8 text-white">
        <span className="block text-[12px] font-bold uppercase tracking-[.08em] text-white/80">Photos</span>
        <span className="block text-[17px] font-extrabold leading-tight">{photos.length} photo{photos.length === 1 ? "" : "s"}</span>
        <span className="block text-[13px] text-white/80">Latest {fmtShort(photos[0].date)}</span>
      </span>
    </button>
  );
}

// ─────────────────────────────── Schedule
function ScheduleTab({ data, action }: { data: PortalData; action: ClientAction }) {
  const today = todayISO();
  if (data.schedule.length === 0) return <Empty>Your project timeline will appear here once it&apos;s scheduled.</Empty>;
  return (
    <>
      <p className="px-1 text-[14px] leading-relaxed text-[var(--muted)]">
        <b className="text-[var(--ink)]">Confirmed</b> dates are locked with our trades. <b className="text-[var(--ink)]">Estimated</b> dates firm up as work gets closer.
      </p>
      <ol className="card divide-y divide-[var(--line)]">
        {data.schedule.map((p) => {
          const teamDone = p.status === "completed";
          const clientDone = !teamDone && !!p.client_completed;
          const isDone = teamDone;
          const isNow = !isDone && p.status === "in_progress";
          // The client can tick off work that has started; future phases stay the team's.
          const canMark = !isDone && !clientDone && (isNow || (!!p.start_date && p.start_date <= today));
          const busy = action.busy === `phase:${p.id}`;
          const isInspection = p.event_type === "inspection";
          const chip = isDone ? ["Done", "#2F6B4F"] : clientDone ? ["Awaiting verification", "#7A5A1E"] : isNow ? ["In progress", "#C66638"] : p.firm ? ["Confirmed", "#252D2B"] : ["Estimated", "#8A918C"];
          return (
            <li key={p.id} className={`flex gap-3 p-4 ${isNow ? "bg-[#FBF1EB]" : ""}`}>
              <span className={`mt-1 h-3.5 w-3.5 shrink-0 ${isInspection ? "rotate-45 rounded-[3px]" : "rounded-full"}`}
                style={{ background: isDone || isNow ? chip[1] : "transparent", border: `2px solid ${chip[1]}` }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className={`text-[16px] font-bold ${isDone ? "text-[var(--muted)]" : ""}`}>{p.name}</p>
                  <span className="shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-bold text-white" style={{ background: chip[1] }}>{chip[0]}</span>
                </div>
                {p.description && <p className="mt-0.5 text-[14px] text-[var(--muted)]">{p.description}</p>}
                <p className="mt-1 text-[14px] font-semibold text-[var(--muted)]">
                  {p.actual_completion_date ? `Passed ${fmtDate(p.actual_completion_date)}` : p.firm || isDone || isNow ? `${fmtDate(p.start_date)} – ${fmtDate(p.end_date)}` : weekOf(p.start_date)}
                </p>
                {clientDone && (
                  <div className="mt-2 flex items-center gap-3 text-[14px]">
                    <span className="font-semibold text-[#7A5A1E]">You reported this complete — awaiting team verification</span>
                    <button disabled={!action.enabled || busy} onClick={() => action.act("phase", p.id, "uncomplete")}
                      className="min-h-[36px] font-bold text-[var(--accent-dark)] disabled:opacity-50">{busy ? "Saving…" : "Undo"}</button>
                  </div>
                )}
                {canMark && (
                  <button disabled={!action.enabled || busy} onClick={() => action.act("phase", p.id, "complete")}
                    className="btn btn-ghost mt-2 disabled:opacity-50">{busy ? "Saving…" : "✓ Mark complete"}</button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}

// ─────────────────────────────── Selections
function countStatuses(items: PortalSelectionItem[]) {
  const c = { selected: 0, proposed: 0, pending: 0, reused: 0, ordered: 0, installed: 0 };
  for (const i of items) if (i.client_action !== "removed") c[itemStatus(i)] += 1;
  return c;
}

function SelectionsTab({ data, decisions, token, onReload, action }: { data: PortalData; decisions: PortalDecision[]; token?: string; onReload?: () => void; action: ClientAction }) {
  const sheet = data.selection_sheet;
  if (!sheet && decisions.length === 0) {
    return <Empty>No selections yet. We&apos;ll email you when there&apos;s something to choose.</Empty>;
  }
  return (
    <>
      {sheet && <SheetView sheet={sheet} action={action} preview={data.mode === "preview"} />}
      {decisions.length > 0 && <Decisions decisions={decisions} token={token} onReload={onReload} preview={data.mode === "preview"} action={action} />}
    </>
  );
}

function SheetView({ sheet, action, preview }: { sheet: PortalSelectionSheet; action: ClientAction; preview: boolean }) {
  const [showRemoved, setShowRemoved] = useState(false);
  const counts = countStatuses(sheet.items);
  const removed = sheet.items.filter((i) => i.client_action === "removed");
  const sections: { name: string; items: PortalSelectionItem[] }[] = [];
  for (const it of sheet.items.filter((i) => i.client_action !== "removed")) {
    const name = it.section || "Selections";
    const last = sections[sections.length - 1];
    if (last && last.name === name) last.items.push(it);
    else sections.push({ name, items: [it] });
  }
  return (
    <>
      <section className="card p-4">
        {sheet.staged && <p className="mb-2"><Draft /></p>}
        <p className="label">{sheet.sheet_date ? `Updated ${fmtDate(sheet.sheet_date)}` : "Selections"}</p>
        <h2 className="mt-1 text-[22px] font-extrabold leading-tight">{[sheet.title, sheet.revision].filter(Boolean).join(" ")}</h2>
        {sheet.intro && <p className="mt-1.5 text-[15px] leading-relaxed text-[var(--muted)]">{sheet.intro}</p>}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(Object.keys(STATUS) as SelectionItemStatus[]).filter((k) => counts[k] > 0).map((k) => (
            <span key={k} className="rounded-full px-2.5 py-1 text-[13px] font-bold text-white" style={{ background: STATUS[k].color }}>
              {counts[k]} {STATUS[k].label.toLowerCase()}
            </span>
          ))}
        </div>
        {sheet.pdf_url && (
          <a href={sheet.pdf_url} target="_blank" rel="noreferrer" className="btn btn-primary mt-4 w-full">Open the full selection sheet (PDF)</a>
        )}
      </section>

      {sections.map((s) => (
        <section key={s.name} className="space-y-3">
          <h3 className="px-1 pt-2 text-[18px] font-extrabold">{s.name}</h3>
          {s.items.map((it) => <ItemCard key={it.id} item={it} showPrices={sheet.show_prices} action={action} />)}
        </section>
      ))}

      {removed.length > 0 && (
        <section className="space-y-2">
          <button onClick={() => setShowRemoved(!showRemoved)} className="card w-full p-3 text-left text-[15px] font-bold text-[var(--muted)]">
            {showRemoved ? "Hide" : "Show"} {removed.length} item{removed.length === 1 ? "" : "s"} {preview ? "the client removed" : "you removed"}
          </button>
          {showRemoved && removed.map((it) => (
            <div key={it.id} className="card flex items-center justify-between gap-3 p-3 opacity-80">
              <span className="min-w-0 text-[15px] font-semibold line-through">{it.name}</span>
              <button disabled={!action.enabled || action.busy === `item:${it.id}`} onClick={() => action.act("item", it.id, "clear")}
                className="btn btn-ghost shrink-0 disabled:opacity-50">{action.busy === `item:${it.id}` ? "Saving…" : "Put back"}</button>
            </div>
          ))}
        </section>
      )}

      {sheet.allowances.length > 0 && (
        <section className="card p-4">
          <p className="label">Allowance check</p>
          <ul className="mt-2 divide-y divide-[var(--line)]">
            {sheet.allowances.map((a, i) => (
              <li key={i} className="py-3">
                <p className="text-[16px] font-bold">{a.name}</p>
                <div className="mt-1 flex flex-wrap gap-x-4 text-[14px]">
                  <span>Allowance <b>{fmt(a.allowance)}</b></span>
                  <span>Selected so far <b className={a.selected == null ? "text-[#B4471F]" : ""}>{a.selected == null ? "Pending" : fmt(a.selected)}</b></span>
                </div>
                {a.status && <p className="mt-1 text-[14px] text-[var(--muted)]">{a.status}</p>}
              </li>
            ))}
          </ul>
          {sheet.allowance_note && <p className="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">{sheet.allowance_note}</p>}
        </section>
      )}

      {sheet.notes.map((n, i) => (
        <section key={i} className="card p-4">
          <p className="text-[16px] font-extrabold text-[var(--accent-dark)]">{n.title}</p>
          <p className="mt-1 text-[15px] leading-relaxed">{n.body}</p>
        </section>
      ))}
    </>
  );
}

function ItemCard({ item, showPrices, action }: { item: PortalSelectionItem; showPrices: boolean; action: ClientAction }) {
  const [open, setOpen] = useState(false);
  const st = STATUS[item.status] ?? STATUS.pending;
  const busy = action.busy === `item:${item.id}`;
  // Approve only means something on items that aren't already the client's pick.
  const canApprove = !item.client_action && !["selected", "reused", "ordered", "installed"].includes(item.status);
  const hasPrice = showPrices && (item.ext_price != null || item.unit_price);
  return (
    <article className="card overflow-hidden">
      <div className="flex gap-3 p-3.5">
        <div className="flex h-[92px] w-[92px] shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--line)] bg-white">
          {item.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.image_url} alt={item.name} className="h-full w-full object-contain p-1" loading="lazy" />
          ) : <span className="text-[12px] text-[var(--muted)]">No photo</span>}
        </div>
        <div className="min-w-0 flex-1">
          <span className="inline-block rounded-md px-2 py-0.5 text-[12px] font-bold text-white" style={{ background: st.color }}>
            {item.status_label || st.label}
          </span>
          <p className="mt-1 text-[16px] font-bold leading-snug">{item.name}</p>
          {item.brand_model && <p className="mt-0.5 text-[14px] text-[var(--muted)]">{item.brand_model}</p>}
        </div>
      </div>
      {(item.quantity || hasPrice) && (
        <div className="flex items-baseline justify-between gap-3 border-t border-[var(--line)] px-3.5 py-2.5 text-[14px]">
          <span className="text-[var(--muted)]">
            {item.quantity && <>Qty <b className="text-[var(--ink)]">{item.quantity}</b></>}
            {showPrices && item.unit_price && <> · {item.unit_price}</>}
          </span>
          {showPrices && (
            <span className="shrink-0 text-[17px] font-extrabold">
              {item.ext_price != null ? fmt(item.ext_price) : <span className="text-[#B4471F]">Price pending</span>}
            </span>
          )}
        </div>
      )}
      {(item.details || item.price_note || item.product_url) && (
        <div className="border-t border-[var(--line)] px-3.5 py-2.5">
          {item.details && (
            <p className={`whitespace-pre-line text-[14px] leading-relaxed text-[var(--ink)] ${open ? "" : "clamp3"}`}>{item.details}</p>
          )}
          {item.price_note && open && <p className="mt-1.5 text-[13px] text-[var(--muted)]">{item.price_note}</p>}
          <div className="mt-1 flex flex-wrap items-center gap-x-5">
            {(item.details?.length ?? 0) > 120 || item.price_note ? (
              <button onClick={() => setOpen(!open)} className="min-h-[36px] text-[14px] font-bold text-[var(--accent-dark)]">{open ? "Less" : "More details"}</button>
            ) : null}
            {item.product_url && (
              <a href={item.product_url} target="_blank" rel="noreferrer" className="inline-flex min-h-[36px] items-center text-[14px] font-bold text-[var(--accent-dark)]">
                {item.link_label || "View product"} →
              </a>
            )}
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 border-t border-[var(--line)] px-3.5 py-2.5">
        {item.client_action === "approved" ? (
          <>
            <span className="flex-1 text-[15px] font-bold text-[#2F6B4F]">✓ Approved</span>
            <button disabled={!action.enabled || busy} onClick={() => action.act("item", item.id, "clear")}
              className="min-h-[40px] px-2 text-[14px] font-bold text-[var(--accent-dark)] disabled:opacity-50">{busy ? "Saving…" : "Undo"}</button>
          </>
        ) : (
          <>
            {canApprove && (
              <button disabled={!action.enabled || busy} onClick={() => action.act("item", item.id, "approve")}
                className="btn btn-primary flex-1 disabled:opacity-50">{busy ? "Saving…" : "✓ Approve"}</button>
            )}
            <button disabled={!action.enabled || busy} onClick={() => action.act("item", item.id, "remove")}
              className={`btn btn-ghost disabled:opacity-50 ${canApprove ? "" : "flex-1"}`}>Remove</button>
          </>
        )}
      </div>
    </article>
  );
}

// Decision rows from client_selections — option picker or owner-supplied text.
function Decisions({ decisions, token, onReload, preview, action }: { decisions: PortalDecision[]; token?: string; onReload?: () => void; preview: boolean; action: ClientAction }) {
  const [showDismissed, setShowDismissed] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const canPick = !!token && !preview;
  // Preview: rows hidden from the client stay folded so the page reads the
  // way the client will see it.
  const hiddenCount = decisions.filter((s) => s.client_visible === false).length;
  // Rows the client marked "Not needed" fold away, with a way back.
  const dismissed = decisions.filter((s) => s.client_visible !== false && !!s.client_dismissed_at);
  const shown = decisions.filter((s) => (s.client_visible !== false || showHidden) && !s.client_dismissed_at);

  async function send(body: Record<string, string>, key: string) {
    if (!canPick) return;
    setPicking(key);
    const res = await fetch("/api/portal/select", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, ...body }),
    });
    const d = await res.json();
    setPicking(null);
    if (d.success) { setEditing(null); onReload?.(); }
    else alert(d.error || "Could not save. Please try again.");
  }

  return (
    <>
      {shown.some((s) => s.client_visible !== false) && <h3 className="px-1 pt-2 text-[18px] font-extrabold">Decisions</h3>}
      {hiddenCount > 0 && (
        <button onClick={() => setShowHidden(!showHidden)} className="card w-full p-3 text-left text-[14px] font-bold text-[#7A2E12]">
          {showHidden ? "Fold" : "Show"} {hiddenCount} decision row{hiddenCount === 1 ? "" : "s"} hidden from the client (staff only)
        </button>
      )}
      {shown.map((s) => {
        const hidden = s.client_visible === false;
        return (
          <section key={s.id} className={`card p-4 ${hidden ? "opacity-60" : ""}`}>
            {hidden && <p className="mb-2"><Draft>Hidden from client</Draft></p>}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[17px] font-extrabold">{s.category}</p>
                {s.description && <p className="mt-0.5 text-[14px] text-[var(--muted)]">{s.description}</p>}
              </div>
              <span className="shrink-0 rounded-md px-2 py-0.5 text-[12px] font-bold text-white"
                style={{ background: s.status === "selected" ? STATUS.selected.color : STATUS.pending.color }}>
                {s.status === "selected" ? "Selected" : "Your choice"}
              </span>
            </div>
            {s.allowance_amount != null && <p className="mt-1.5 text-[14px] text-[var(--muted)]">Allowance {fmt(s.allowance_amount)}</p>}

            {s.status === "selected" && editing !== s.id ? (
              <div className="mt-3 flex items-start gap-3 rounded-xl bg-[#EEF5F0] p-3">
                <p className="min-w-0 flex-1 whitespace-pre-line text-[15px] font-semibold">{s.selected_value}</p>
                {s.client_done_at && (
                  <button disabled={!action.enabled || action.busy === `decision:${s.id}`} onClick={() => action.act("decision", s.id, "restore")}
                    className="shrink-0 text-[14px] font-bold text-[var(--accent-dark)] disabled:opacity-50">Undo</button>
                )}
                {s.options.length === 0 && canPick && !s.client_done_at && (
                  <button onClick={() => { setEditing(s.id); setDrafts((d) => ({ ...d, [s.id]: s.selected_value || "" })); }}
                    className="shrink-0 text-[14px] font-bold text-[var(--accent-dark)]">Edit</button>
                )}
              </div>
            ) : s.options.length === 0 ? (
              <div className="mt-3 space-y-2">
                <p className="text-[14px] text-[var(--muted)]">Tell us what you picked or already own: model, finish, color, where it&apos;s stored.</p>
                <textarea value={drafts[s.id] ?? ""} disabled={!canPick} rows={3} maxLength={600}
                  onChange={(e) => setDrafts((d) => ({ ...d, [s.id]: e.target.value }))}
                  placeholder="e.g. Delta Trinsic faucet 9159-AR-DST, boxes in the garage"
                  className="w-full resize-none rounded-xl border border-[var(--line)] bg-white p-3 text-[16px] focus:border-[var(--accent)] focus:outline-none" />
                <div className="flex justify-end gap-2">
                  {editing === s.id && <button onClick={() => setEditing(null)} className="btn btn-ghost">Cancel</button>}
                  <button disabled={!canPick || !!picking || !(drafts[s.id] ?? "").trim()}
                    onClick={() => send({ selectionId: s.id, ownerValue: drafts[s.id] ?? "" }, s.id + "owner")}
                    className="btn btn-primary disabled:opacity-40">{picking === s.id + "owner" ? "Saving…" : "Save"}</button>
                </div>
              </div>
            ) : (
              <div className="mt-3 grid gap-2">
                {s.options.map((opt) => (
                  <button key={opt.id} disabled={!canPick || !!picking}
                    onClick={() => send({ selectionId: s.id, optionId: opt.id }, s.id + opt.id)}
                    className="flex min-h-[56px] items-center gap-3 rounded-xl border border-[var(--line)] bg-white p-3 text-left disabled:opacity-60">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[var(--paper)]">
                      {opt.image_url
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={opt.image_url} alt={opt.label} className="h-full w-full object-cover" />
                        : <span className="text-[18px] font-bold text-[var(--muted)]">{opt.label.charAt(0)}</span>}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-bold">{opt.label}</span>
                      {opt.description && <span className="block text-[13px] text-[var(--muted)]">{opt.description}</span>}
                    </span>
                    <span className="shrink-0 text-right">
                      {opt.price_delta != null && opt.price_delta !== 0 && (
                        <span className="block text-[14px] font-bold">{opt.price_delta > 0 ? "+" : "−"}{fmt(Math.abs(opt.price_delta))}</span>
                      )}
                      <span className="text-[14px] font-bold text-[var(--accent-dark)]">{picking === s.id + opt.id ? "Saving…" : "Choose"}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
            {s.status === "pending" && !hidden && (
              <div className="mt-3 flex gap-2 border-t border-[var(--line)] pt-3">
                <button disabled={!action.enabled || !!action.busy} onClick={() => action.act("decision", s.id, "done")}
                  className="btn btn-ghost flex-1 disabled:opacity-50">{action.busy === `decision:${s.id}` ? "Saving…" : "✓ Mark done"}</button>
                <button disabled={!action.enabled || !!action.busy} onClick={() => action.act("decision", s.id, "not_needed")}
                  className="btn btn-ghost flex-1 disabled:opacity-50">Not needed</button>
              </div>
            )}
          </section>
        );
      })}
      {dismissed.length > 0 && (
        <section className="space-y-2">
          <button onClick={() => setShowDismissed(!showDismissed)} className="card w-full p-3 text-left text-[15px] font-bold text-[var(--muted)]">
            {showDismissed ? "Hide" : "Show"} {dismissed.length} marked not needed
          </button>
          {showDismissed && dismissed.map((s) => (
            <div key={s.id} className="card flex items-center justify-between gap-3 p-3 opacity-80">
              <span className="min-w-0 text-[15px] font-semibold line-through">{s.category}</span>
              <button disabled={!action.enabled || action.busy === `decision:${s.id}`} onClick={() => action.act("decision", s.id, "restore")}
                className="btn btn-ghost shrink-0 disabled:opacity-50">Put back</button>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

// ─────────────────────────────── Documents
function DocumentsTab({ docs }: { docs: PortalDocument[] }) {
  const groups = useMemo(
    () => DOC_GROUPS.map((g) => ({ ...g, docs: docs.filter((d) => (d.group === "drawing" ? "design" : d.group) === g.key) })).filter((g) => g.docs.length > 0),
    [docs],
  );
  if (docs.length === 0) return <Empty>Your design, selections, contract and invoices will appear here.</Empty>;
  return (
    <>
      {groups.map((g) => (
        <section key={g.key}>
          <h3 className="px-1 pb-2 pt-1 text-[18px] font-extrabold">{g.label}</h3>
          <ul className="card divide-y divide-[var(--line)]">
            {g.docs.map((d) => (
              <li key={d.id}>
                <a href={d.url} target="_blank" rel="noreferrer" className="flex min-h-[60px] items-center gap-3 px-4 py-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--paper)] text-[11px] font-extrabold text-[var(--accent-dark)]">PDF</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[16px] font-bold leading-snug">{d.title}</span>
                    <span className="block text-[13px] text-[var(--muted)]">{[d.subtitle, d.date ? fmtDate(d.date) : null].filter(Boolean).join(" · ")}</span>
                    {d.staged && <span className="mt-1 block"><Draft /></span>}
                  </span>
                  <span className="shrink-0 text-[20px] text-[var(--muted)]">›</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

// ─────────────────────────────── Payments
function PaymentsTab({ data, mailto }: { data: PortalData; mailto: string }) {
  const f = data.financials;
  if (!f) return <Empty>Payment details will appear here shortly.</Empty>;
  const paidPct = f.adjusted_contract > 0 ? Math.min(100, Math.round((f.total_payments_received / f.adjusted_contract) * 100)) : 0;
  return (
    <>
      <section className="card p-4">
        <p className="label">Contract total</p>
        <p className="mt-1 text-[30px] font-extrabold leading-none">{fmt(f.adjusted_contract || f.contract_value)}</p>
        {f.change_order_revenue !== 0 && (
          <p className="mt-1.5 text-[14px] text-[var(--muted)]">Includes {fmt(f.change_order_revenue)} in approved changes ({f.change_order_count})</p>
        )}
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--line)]">
          <div className="h-full rounded-full bg-[#2F6B4F]" style={{ width: `${paidPct}%` }} />
        </div>
        <div className="mt-3 flex justify-between">
          <div>
            <p className="label">Paid to date</p>
            <p className="text-[18px] font-extrabold text-[#2F6B4F]">{fmt(f.total_payments_received)}</p>
          </div>
          <div className="text-right">
            <p className="label">Balance</p>
            <p className="text-[18px] font-extrabold">{fmt(f.outstanding_receivable)}</p>
          </div>
        </div>
      </section>

      {data.invoices.length > 0 && (
        <section className="card p-4">
          <p className="label">Invoices</p>
          <ul className="mt-1 divide-y divide-[var(--line)]">
            {data.invoices.map((inv) => (
              <li key={inv.id}>
                <a href={inv.url} target="_blank" rel="noreferrer" className="flex min-h-[56px] items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block text-[16px] font-bold">Invoice {inv.invoice_number}{inv.title ? ` · ${inv.title}` : ""}</span>
                    <span className="block text-[13px] text-[var(--muted)]">{fmtDate(inv.date)} · Open PDF</span>
                  </span>
                  <span className="shrink-0 text-[16px] font-extrabold">{fmt(inv.amount)}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card p-4">
        <p className="label">Payments received</p>
        {data.payments.length === 0 ? <p className="mt-2 text-[15px] text-[var(--muted)]">No payments recorded yet.</p> : (
          <ul className="mt-1 divide-y divide-[var(--line)]">
            {data.payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block text-[16px] font-semibold capitalize">{p.description || p.payment_type}</span>
                  <span className="block text-[13px] text-[var(--muted)]">{fmtDate(p.received_date)}{p.invoice_sent_number ? ` · Invoice ${p.invoice_sent_number}` : ""}</span>
                </span>
                <span className="shrink-0 text-[16px] font-extrabold text-[#2F6B4F]">{fmt(p.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.change_orders.length > 0 && (
        <section className="card p-4">
          <p className="label">Change orders</p>
          <ul className="mt-1 divide-y divide-[var(--line)]">
            {data.change_orders.map((co) => (
              <li key={co.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block text-[16px] font-semibold">No. {co.change_order_number} · {co.title}</span>
                  <span className="block text-[13px] text-[var(--muted)]">{co.signed || co.status === "approved" ? "Approved" : "Awaiting your signature"}</span>
                  {co.url && <a href={co.url} target="_blank" rel="noreferrer" className="mt-0.5 inline-block text-[14px] font-bold text-[var(--accent-dark)]">{co.signed ? "View" : "Review and sign"} →</a>}
                </span>
                <span className="shrink-0 text-[16px] font-extrabold">{co.price_impact >= 0 ? "+" : "−"}{fmt(Math.abs(co.price_impact))}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="text-center text-[14px] text-[var(--muted)]">Questions about billing? <a href={mailto} className="font-bold text-[var(--accent-dark)] underline">Email us</a></p>
    </>
  );
}

// ─────────────────────────────── Photos
function PhotosTab({ photos, onOpen }: { photos: PortalPhoto[]; onOpen: (index: number) => void }) {
  if (photos.length === 0) return <Empty>Progress photos will appear here as our crew posts from your job site.</Empty>;
  const groups: { date: string; items: { ph: PortalPhoto; index: number }[] }[] = [];
  photos.forEach((ph, index) => {
    const last = groups[groups.length - 1];
    if (last && last.date === ph.date) last.items.push({ ph, index });
    else groups.push({ date: ph.date, items: [{ ph, index }] });
  });
  return (
    <>
      {groups.map((g, gi) => (
        <section key={`${g.date}-${gi}`}>
          <h3 className="px-1 pb-2 text-[16px] font-extrabold">{fmtDate(g.date)}</h3>
          <div className="grid grid-cols-3 gap-1.5">
            {g.items.map(({ ph, index }) => (
              <button key={index} onClick={() => onOpen(index)} className="aspect-square overflow-hidden rounded-lg bg-[var(--line)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={ph.thumb} alt="Progress photo" loading="lazy" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

// Full-screen photo viewer: swipe (phone), arrow buttons or arrow keys to
// move through every photo; Esc or Close to leave.
function PhotoViewer({ photos, index, onIndex, onClose }: { photos: PortalPhoto[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const touchX = useRef<number | null>(null);
  const count = photos.length;
  const prev = () => onIndex((index - 1 + count) % count);
  const next = () => onIndex((index + 1) % count);
  const ph = photos[index];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") onIndex((index - 1 + count) % count);
      else if (e.key === "ArrowRight") onIndex((index + 1) % count);
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; };
  }, [index, count, onIndex, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white"
      onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        const start = touchX.current;
        touchX.current = null;
        if (start == null) return;
        const dx = e.changedTouches[0].clientX - start;
        if (dx > 40) prev();
        else if (dx < -40) next();
      }}>
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-[15px] font-bold">{index + 1} / {count}<span className="ml-2 font-semibold text-white/60">{fmtDate(ph.date)}</span></span>
        <button onClick={onClose} className="btn text-white">Close</button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img key={ph.full} src={ph.full} alt={`Progress photo ${index + 1}`} className="max-h-full max-w-full rounded-lg object-contain" />
        {count > 1 && (
          <>
            <button aria-label="Previous photo" onClick={prev}
              className="absolute left-2 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-[26px] font-bold backdrop-blur">‹</button>
            <button aria-label="Next photo" onClick={next}
              className="absolute right-2 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-[26px] font-bold backdrop-blur">›</button>
            {/* Warm the neighbors so swiping feels instant. */}
            <span className="hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photos[(index + 1) % count].full} alt="" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photos[(index - 1 + count) % count].full} alt="" />
            </span>
          </>
        )}
      </div>
    </div>
  );
}
