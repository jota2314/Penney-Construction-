"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { CalendarDays, ClipboardList, HardHat, Home, Wallet } from "lucide-react";
import type { Tab } from "./types";

// ── Theme primitives shared by /sub and /sub/portal ────────────────────────
// Signage-weight display face + technical mono numerals over near-black, one
// amber accent. Same palette as the client portal so both feel like Penney.

export const DISPLAY = { fontFamily: "var(--font-archivo), sans-serif" } as const;
export const MONO = { fontFamily: "var(--font-plex-mono), monospace" } as const;

export const OFFICE_PHONE = "978-621-4387";

export const fmt = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;

export const fmtDate = (d: string | null) =>
  d
    ? new Date(d + (d.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    : "TBD";

export const fmtShortDate = (d: string | null) =>
  d
    ? new Date(d + (d.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    : "";

export const fmtLogTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export const fmtClock = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

// Plain-language job status for subs — where the job stands, no pipeline jargon.
const STATUS_LABELS: Record<string, string> = {
  lead: "Early planning",
  estimating: "Being priced",
  proposal_sent: "Proposal out",
  contracted: "Contract signed",
  in_progress: "In construction",
  on_hold: "On hold",
  completed: "Completed",
  audit: "Closing out",
};
export const statusLabel = (s: string) => STATUS_LABELS[s] || s.replace(/_/g, " ");

export const FILE_LABELS: Record<string, string> = {
  construction_drawings: "Drawings",
  specs: "Specs",
  permits: "Permits",
};

/** How a quote/bid status reads to the sub. */
export function quoteStatusLabel(status: string): { label: string; tone: Tone } {
  switch (status) {
    case "accepted":
    case "approved":
      return { label: "Awarded", tone: "amber" };
    case "declined":
    case "rejected":
      return { label: "Not selected", tone: "muted" };
    case "received":
    case "submitted":
    case "in_progress":
      return { label: "Under review", tone: "neutral" };
    case "just_sent":
    case "awaiting_reply":
    case "invited":
      return { label: "Price needed", tone: "blue" };
    default:
      return { label: status.replace(/_/g, " "), tone: "neutral" };
  }
}

/**
 * Wall-clock time that re-renders every `intervalMs` — keeps "on the clock
 * 2.3 h" honest without calling Date.now() during render.
 */
export function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export const inputCls =
  "w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-3 text-[15px] text-stone-100 outline-none placeholder:text-stone-600 focus:border-amber-500/60";
export const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-stone-950 transition-opacity active:opacity-80 disabled:opacity-40";
export const btnGhost =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-stone-200 transition-colors hover:border-amber-500/40 active:opacity-80 disabled:opacity-40";

// ── Layout ─────────────────────────────────────────────────────────────────

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div
      className="min-h-screen bg-[#0b0a08] text-stone-200"
      style={{ fontFamily: "var(--font-geist-sans), sans-serif" }}
    >
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(90% 50% at 90% -10%, rgba(217,119,6,.16), transparent 60%)",
        }}
      />
      <div className="relative">{children}</div>
    </div>
  );
}

export function Card({
  children,
  className = "",
  tone = "default",
}: {
  children: ReactNode;
  className?: string;
  tone?: "default" | "amber" | "emerald";
}) {
  const border =
    tone === "amber"
      ? "border-amber-500/30 bg-amber-500/[0.06]"
      : tone === "emerald"
        ? "border-emerald-500/30 bg-emerald-500/[0.05]"
        : "border-white/[0.08] bg-white/[0.025]";
  return <div className={`rounded-2xl border ${border} ${className}`}>{children}</div>;
}

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2.5 flex items-baseline justify-between gap-3">
      <p className="text-[10px] tracking-[0.3em] uppercase text-stone-500" style={MONO}>
        {children}
      </p>
      {right}
    </div>
  );
}

export type Tone = "amber" | "emerald" | "red" | "blue" | "neutral" | "muted";
const PILL_TONES: Record<Tone, string> = {
  amber: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  emerald: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  red: "border-red-500/40 bg-red-500/10 text-red-400",
  blue: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  neutral: "border-white/15 text-stone-300",
  muted: "border-white/10 text-stone-500",
};
export function Pill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.14em] ${PILL_TONES[tone]}`}
      style={MONO}
    >
      {children}
    </span>
  );
}

export function StatTile({
  label,
  value,
  hint,
  tone = "neutral",
  onClick,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "amber" | "emerald";
  onClick?: () => void;
}) {
  const valueColor =
    tone === "amber" ? "text-amber-400" : tone === "emerald" ? "text-emerald-400" : "text-stone-100";
  const inner = (
    <>
      <p className="text-[10px] tracking-[0.24em] uppercase text-stone-500" style={MONO}>
        {label}
      </p>
      <p className={`mt-1.5 text-[22px] leading-none font-bold ${valueColor}`} style={DISPLAY}>
        {value}
      </p>
      {hint && <p className="mt-1.5 text-[11px] text-stone-500 truncate">{hint}</p>}
    </>
  );
  const cls = "rounded-2xl border border-white/[0.08] bg-white/[0.025] px-4 py-3.5 text-left";
  return onClick ? (
    <button onClick={onClick} className={`${cls} w-full transition-colors hover:border-amber-500/40`}>
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

/** Thin paid-vs-total bar used on job and billing rows. */
export function ProgressBar({ value, max, tone = "emerald" }: { value: number; max: number; tone?: "emerald" | "amber" }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
      <div
        className={`h-full rounded-full ${tone === "amber" ? "bg-amber-500" : "bg-emerald-500"}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function EmptyState({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body?: string }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 text-stone-500">
        <Icon className="h-5 w-5" />
      </span>
      <p className="mt-4 text-[14px] font-semibold text-stone-300">{title}</p>
      {body && <p className="mt-1 max-w-xs text-[12px] leading-relaxed text-stone-500">{body}</p>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-white/[0.05] ${className}`} />;
}

export function Notice({ kind, text }: { kind: "ok" | "err"; text: string }) {
  return (
    <p
      className={`rounded-xl border px-3.5 py-3 text-[13px] ${
        kind === "ok"
          ? "border-emerald-500/40 bg-emerald-500/[0.06] text-emerald-300"
          : "border-red-500/40 bg-red-500/[0.06] text-red-300"
      }`}
    >
      {text}
    </p>
  );
}

// ── Bottom navigation ──────────────────────────────────────────────────────

const TABS: { key: Tab; label: string; icon: LucideIcon }[] = [
  { key: "home", label: "Home", icon: Home },
  { key: "schedule", label: "Schedule", icon: CalendarDays },
  { key: "jobs", label: "Jobs", icon: ClipboardList },
  { key: "money", label: "Money", icon: Wallet },
  { key: "field", label: "Field", icon: HardHat },
];

export function BottomNav({
  tab,
  onChange,
  badges,
}: {
  tab: Tab;
  onChange: (t: Tab) => void;
  badges?: Partial<Record<Tab, boolean>>;
}) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-white/[0.08] bg-[#0b0a08]/90 backdrop-blur-md"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto flex max-w-2xl">
        {TABS.map(({ key, label, icon: Icon }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              onClick={() => onChange(key)}
              className={`relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[9px] uppercase tracking-[0.16em] transition-colors ${
                active ? "text-amber-400" : "text-stone-500 hover:text-stone-300"
              }`}
              style={MONO}
              aria-current={active ? "page" : undefined}
            >
              <span className="relative">
                <Icon className="h-5 w-5" strokeWidth={active ? 2.2 : 1.8} />
                {badges?.[key] && (
                  <span className="absolute -right-1.5 -top-1 h-2 w-2 rounded-full bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,.8)]" />
                )}
              </span>
              {label}
              {active && (
                <span className="absolute top-0 h-[2px] w-8 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,.6)]" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/** Small "Directions →" link for an address. */
export function DirectionsLink({ address }: { address: string }) {
  return (
    <a
      href={`https://maps.google.com/?q=${encodeURIComponent(address)}`}
      target="_blank"
      rel="noreferrer"
      className="inline-block text-[11px] uppercase tracking-[0.14em] text-amber-500/90"
      style={MONO}
    >
      Directions →
    </a>
  );
}
