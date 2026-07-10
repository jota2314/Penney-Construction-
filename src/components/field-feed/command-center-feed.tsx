"use client";

/**
 * Command Center — feed-style implementation of the design at
 * design-pkg/.../prototypes/command-center/Command Center.html
 *
 * Faithfully ports the design's roles, card types, color tokens and gestures.
 * Skips the design's left sidebar — the production app already provides one.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { TodayPhase, FeedDailyLog, FeedPunchGroup, WeekSchedulePhase } from "@/lib/actions/daily-logs";
import { PunchListGroupPost } from "@/components/field-feed/punch-list-group-post";
import { approveDecision, rejectDecision } from "@/lib/actions/decisions";
import { markEmailProcessed, dismissEmail } from "@/lib/actions/email-actions";
import { snoozeTodo, updateTodoStatus } from "@/lib/actions/command-center";
import { TodaysWorkCard } from "./todays-work-card";
import { DailyLogPost } from "./daily-log-post";
import { ScheduleStrip } from "./schedule-strip";
import { GlobalSearch } from "@/components/command-center/global-search";
import { JobClockInSheet } from "./job-clock-in-sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RoleId = "owner" | "estimator" | "admin" | "lead" | "crew";
export type Priority = "urgent" | "high" | "normal";

type Role = { id: RoleId; name: string; role: string; avatar: string };
export type PersonId = string;
type Person = { name: string; role: string; color: string };

export type Jobsite = {
  id: string;
  project: string;
  address: string;
  crew: PersonId[];
  lead: PersonId | null;
  status: string;
  phase: string;
  weather: string;
  color: string;
};

export type FeedEmailSummary = {
  id: string;
  subject: string;
  sender: string;
  snippet: string;
  date: string;
  urgent: boolean;
};

export type FeedTodoSummary = {
  id: string;
  description: string;
  project: string | null;
  priority: Priority;
  dueDate: string | null;
};

export type ActionCardData = {
  type: "action";
  id: string;
  priority: Priority;
  kind: string;
  eyebrow: string;
  title: string;
  lines?: string[];
  tasks?: string[];
  hugeAddress?: boolean;
  primary?: { label: string; icon: IconName };
  secondary?: { label: string; icon: IconName };
  tertiary?: { label: string; icon: IconName };
  expand?: { title: string; rows: [string, string][]; body?: string };
  decisionId?: string;
  emailId?: string;
  href?: string;
};

export type SwipeSectionId = "decisions" | "emails" | "needs_you";

export type SwipeSection = {
  id: SwipeSectionId;
  label: string;
  cards: ActionCardData[];
};

export type FeedItem =
  | { type: "today"; events: { time: string; what: string; tag: Priority; done: boolean }[] }
  | { type: "section"; label: string }
  | ActionCardData
  | { type: "swipeSections"; sections: SwipeSection[] }
  | { type: "dailyLog"; placeholder: string }
  | { type: "todaysWork"; phases: TodayPhase[] }
  | { type: "weekSchedule"; weekStart: string; weekEnd: string; phases: WeekSchedulePhase[]; myEmployeeIds: string[] }
  | { type: "emailInbox"; emails: FeedEmailSummary[] }
  | { type: "todoInbox"; todos: FeedTodoSummary[] }
  | { type: "logPost"; log: FeedDailyLog }
  | { type: "punchGroupPost"; group: FeedPunchGroup }
  | { type: "jobsites"; sites: Jobsite[]; live?: boolean }
  | { type: "roster"; entries: { siteId: string; crew: PersonId[]; lead: PersonId }[] }
  | { type: "post"; id: string; kind?: "milestone"; who?: PersonId; when: string; project: string; text?: string; headline?: string; sub?: string; photo?: { tone: "framing" | "wall" }; reactions?: Record<string, number> }
  | { type: "metric"; id: string; title: string; big: string; sub: string; side?: string; sparkline?: number[]; bars?: { label: string; value: number }[]; detail?: string }
  | { type: "schedule"; items: { when: string; what: string }[] };

export type IconName =
  | "pen" | "doc" | "clock" | "check" | "x" | "chart" | "skip" | "phone" | "mail"
  | "calendar" | "list" | "tag" | "users" | "send" | "upload" | "map" | "alert"
  | "arrow" | "zap" | "swap";

// ---------------------------------------------------------------------------
// Data — ported verbatim from design's data.js
// ---------------------------------------------------------------------------

const ROLES: Role[] = [
  { id: "owner",     name: "Ryan",   role: "Owner",      avatar: "RP" },
  { id: "estimator", name: "Jorge",  role: "Estimator",  avatar: "JT" },
  { id: "admin",     name: "Nicole", role: "Admin",      avatar: "NC" },
  { id: "lead",      name: "Howie",  role: "Field Lead", avatar: "HW" },
  { id: "crew",      name: "Steven", role: "Field Crew", avatar: "ST" },
];

const PEOPLE: Record<PersonId, Person> = {
  ST: { name: "Steven", role: "Lead Carp",  color: "#D97706" },
  MA: { name: "Marco",  role: "Carpenter",  color: "#0E7490" },
  JO: { name: "Jose",   role: "Laborer",    color: "#7C3AED" },
  TY: { name: "Tyler",  role: "Apprentice", color: "#DC2626" },
  MI: { name: "Mike",   role: "Lead Carp",  color: "#059669" },
  RA: { name: "Rafa",   role: "Carpenter",  color: "#0891B2" },
  HW: { name: "Howie",  role: "Field Lead", color: "#B45309" },
  RP: { name: "Ryan",   role: "Owner",      color: "#1E293B" },
  JT: { name: "Jorge",  role: "Estimator",  color: "#0F766E" },
  NC: { name: "Nicole", role: "Admin",      color: "#7C2D12" },
};

// Real jobsite + feed data is provided by the server via props.


// ---------------------------------------------------------------------------
// CSS variables — design tokens (dark)
// ---------------------------------------------------------------------------

const TOKENS: CSSProperties = {
  // @ts-expect-error — CSS custom properties
  "--pcc-bg":        "#0E0D0B",
  "--pcc-bg-2":      "#1A1814",
  "--pcc-card":      "#16140F",
  "--pcc-ink":       "#F5F1EA",
  "--pcc-muted":     "#A8A29E",
  "--pcc-quiet":     "#6B655F",
  "--pcc-line":      "rgba(255,255,255,0.08)",
  "--pcc-line-soft": "rgba(255,255,255,0.04)",
  "--pcc-accent":    "#D97706",
};

const v = (k: string) => `var(--pcc-${k})`;

// ---------------------------------------------------------------------------
// Icons (inline SVG, currentColor)
// ---------------------------------------------------------------------------

const ICONS: Record<IconName, ReactNode> = {
  pen:      <><path d="M3 17l4-1 9-9-3-3-9 9-1 4z" /><path d="M12 4l3 3" /></>,
  doc:      <><path d="M5 3h7l3 3v11H5z" /><path d="M12 3v3h3" /><path d="M7.5 10h5M7.5 13h5" /></>,
  clock:    <><circle cx="10" cy="10" r="7" /><path d="M10 6v4l2.5 2" /></>,
  check:    <path d="M4 10l4 4 8-9" />,
  x:        <path d="M5 5l10 10M15 5L5 15" />,
  chart:    <><path d="M3 16h14" /><path d="M5 13v-3M9 13V7M13 13v-5M17 13v-2" /></>,
  skip:     <><path d="M5 5v10l6-5z" /><path d="M14 4v12" /></>,
  phone:    <path d="M4 5c0 6 5 11 11 11l1-3-3.5-1.5L11 13c-1.5-.7-2.8-2-3.5-3.5L9 8 7.5 4.5 4.5 5z" />,
  mail:     <><rect x="3" y="5" width="14" height="11" rx="1.5" /><path d="M3.5 6l6.5 5 6.5-5" /></>,
  calendar: <><rect x="3" y="5" width="14" height="12" rx="1.5" /><path d="M3 9h14M7 3v3M13 3v3" /></>,
  list:     <><path d="M7 6h9M7 10h9M7 14h9" /><circle cx="4" cy="6"  r="0.8" fill="currentColor" /><circle cx="4" cy="10" r="0.8" fill="currentColor" /><circle cx="4" cy="14" r="0.8" fill="currentColor" /></>,
  tag:      <><path d="M3 10V4h6l8 8-6 6z" /><circle cx="7" cy="7" r="1" /></>,
  users:    <><circle cx="8" cy="7" r="3" /><path d="M2 17c0-3 2.5-5 6-5s6 2 6 5" /><circle cx="14.5" cy="7.5" r="2.5" /><path d="M14 13c2.5.3 4 1.8 4 4" /></>,
  send:     <><path d="M17 3L3 9l6 2 2 6z" /><path d="M9 11l8-8" /></>,
  upload:   <><path d="M10 14V4M6 8l4-4 4 4" /><path d="M3 16h14" /></>,
  map:      <><path d="M10 3c3 0 5 2 5 5 0 4-5 9-5 9s-5-5-5-9c0-3 2-5 5-5z" /><circle cx="10" cy="8" r="2" /></>,
  alert:    <><path d="M10 3l8 14H2z" /><path d="M10 8v4M10 14.5v.5" /></>,
  arrow:    <><path d="M5 10h10M11 6l4 4-4 4" /></>,
  zap:      <path d="M11 2L4 12h5l-1 6 7-10h-5z" />,
  swap:     <><path d="M4 7h12M13 4l3 3-3 3" /><path d="M16 13H4M7 16l-3-3 3-3" /></>,
};

function Icon({ name, className = "w-5 h-5" }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className}>
      {ICONS[name]}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Shared atoms
// ---------------------------------------------------------------------------

function Avatar({ id, size = 28 }: { id: PersonId; size?: number }) {
  const p = PEOPLE[id] ?? { color: v("bg-2") };
  return (
    <div
      className="rounded-full flex items-center justify-center font-semibold flex-shrink-0 text-white"
      style={{
        width: size, height: size,
        background: p.color,
        border: `1.5px solid ${v("bg")}`,
        fontSize: 10,
        letterSpacing: "0.04em",
      }}
    >
      {id}
    </div>
  );
}

function PriorityPill({ priority }: { priority: Priority }) {
  if (priority === "normal") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-semibold uppercase" style={{ letterSpacing: "0.14em", color: v("quiet") }}>
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: v("quiet") }} />
        Normal
      </span>
    );
  }
  const m = priority === "urgent"
    ? { bg: "rgba(220, 38, 38, 0.14)", fg: "#fca5a5", dot: "#ef4444",     border: "rgba(220, 38, 38, 0.3)", label: "Urgent" }
    : { bg: "rgba(217, 119, 6, 0.14)", fg: "#fbbf24", dot: v("accent"),   border: "rgba(217, 119, 6, 0.3)", label: "High"   };
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-semibold uppercase" style={{ letterSpacing: "0.14em", background: m.bg, color: m.fg, border: `1px solid ${m.border}` }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: m.dot }} />
      {m.label}
    </span>
  );
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const w = 240, h = 40, pad = 4;
  const max = Math.max(...data), min = Math.min(...data);
  const span = Math.max(max - min, 1);
  const pts = data.map((val, i) => {
    const x = pad + (i * (w - pad * 2)) / (data.length - 1);
    const y = h - pad - ((val - min) / span) * (h - pad * 2);
    return [x, y] as const;
  });
  const d = pts.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(" ");
  const area = `${d} L${pts[pts.length - 1][0]},${h} L${pts[0][0]},${h} Z`;
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-10">
      <path d={area} fill={color} opacity={0.12} />
      <path d={d} stroke={color} strokeWidth={1.75} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={3} fill={color} />
    </svg>
  );
}

function MiniMap() {
  return (
    <svg viewBox="0 0 240 72" className="w-full h-full">
      <defs>
        <pattern id="pcc-grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke={v("line")} strokeWidth={0.5} />
        </pattern>
      </defs>
      <rect width="240" height="72" fill="url(#pcc-grid)" />
      <path d="M0,40 L240,32"  stroke={v("line")} strokeWidth={6} opacity={0.5} />
      <path d="M120,0 L130,72" stroke={v("line")} strokeWidth={4} opacity={0.5} />
      <circle cx={125} cy={36} r={6}  fill={v("accent")} />
      <circle cx={125} cy={36} r={12} fill={v("accent")} opacity={0.25} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Card body & action card
// ---------------------------------------------------------------------------

function CardBody({ card }: { card: ActionCardData }) {
  if (card.hugeAddress) {
    return (
      <div className="flex flex-col py-4">
        <div className="text-[12px] font-medium uppercase" style={{ color: v("quiet"), letterSpacing: "0.16em" }}>{card.eyebrow}</div>
        <div className="mt-3 text-[44px] sm:text-[52px] font-semibold leading-[1.02] tracking-tight" style={{ color: v("ink") }}>
          14 Cameron Rd
          <div className="text-[28px] sm:text-[32px] font-medium tracking-tight" style={{ color: v("muted") }}>Lynn, MA</div>
        </div>
        <div className="mt-5 flex flex-col gap-1.5">
          {(card.lines ?? []).map((l, i) => (
            <div key={i} className="text-[16px] sm:text-[17px] leading-snug" style={{ color: v("muted") }}>{l}</div>
          ))}
        </div>
      </div>
    );
  }
  if (card.tasks) {
    return (
      <div className="flex flex-col py-2">
        <div className="text-[12px] font-medium uppercase mb-2" style={{ color: v("quiet"), letterSpacing: "0.16em" }}>{card.eyebrow}</div>
        <div className="text-[24px] font-semibold leading-tight tracking-tight mb-4" style={{ color: v("ink") }}>{card.title}</div>
        <ul className="flex flex-col gap-2.5">
          {card.tasks.map((t, i) => (
            <li key={i} className="flex items-start gap-3 text-[16px]" style={{ color: v("ink") }}>
              <span className="mt-1 w-5 h-5 rounded border-2 flex-shrink-0" style={{ borderColor: v("line") }} />
              <span className="leading-snug">{t}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="flex flex-col py-2">
      <div className="text-[12px] font-medium uppercase mb-2" style={{ color: v("quiet"), letterSpacing: "0.16em" }}>{card.eyebrow}</div>
      <div className="text-[22px] sm:text-[24px] font-semibold leading-[1.15] tracking-tight mb-3" style={{ color: v("ink"), textWrap: "balance" }}>
        {card.title}
      </div>
      <div className="flex flex-col gap-1.5">
        {(card.lines ?? []).map((l, i) => (
          <div key={i} className="text-[15px] sm:text-[16px] leading-snug" style={{ color: v("muted") }}>{l}</div>
        ))}
      </div>
    </div>
  );
}

function ExpandSheet({ expand, onClose }: { expand: NonNullable<ActionCardData["expand"]>; onClose: () => void }) {
  return (
    <div
      className="absolute inset-0 z-30 flex flex-col rounded-2xl overflow-hidden"
      style={{ background: v("card"), border: `1px solid ${v("line")}` }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${v("line")}` }}>
        <div className="text-[12px] font-medium uppercase" style={{ color: v("quiet"), letterSpacing: "0.16em" }}>{expand.title}</div>
        <button onClick={onClose} aria-label="Close" className="opacity-60 hover:opacity-100" style={{ color: v("ink") }}>
          <Icon name="x" />
        </button>
      </div>
      <div className="flex-1 overflow-auto px-5 py-4">
        <div className="flex flex-col">
          {expand.rows.map(([k, val], i) => (
            <div
              key={i}
              className="flex items-baseline justify-between gap-4 py-2.5"
              style={{ borderBottom: i < expand.rows.length - 1 ? `1px solid ${v("line-soft")}` : "none" }}
            >
              <span className="text-[13px]" style={{ color: v("quiet") }}>{k}</span>
              <span className="text-[15px] font-medium text-right" style={{ color: v("ink"), fontVariantNumeric: "tabular-nums" }}>{val}</span>
            </div>
          ))}
        </div>
        {expand.body && <p className="mt-4 text-[14px] leading-relaxed" style={{ color: v("muted") }}>{expand.body}</p>}
      </div>
    </div>
  );
}

type ActionResolution = "skip" | "primary" | "secondary" | "tertiary";

function ActionCard({ card, dismissed, onAction }: {
  card: ActionCardData;
  dismissed?: ActionResolution;
  onAction: (kind: ActionResolution | "undo", card: ActionCardData) => void;
}) {
  const router = useRouter();
  const [drag, setDrag] = useState({ x: 0, y: 0, active: false });
  const [showExpand, setShowExpand] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPos = useRef({ x: 0, y: 0 });
  const moved = useRef(false);

  const onPointerDown = (e: React.PointerEvent) => {
    if (showExpand || dismissed) return;
    if ((e.target as HTMLElement).closest("button")) return;
    cardRef.current?.setPointerCapture?.(e.pointerId);
    startPos.current = { x: e.clientX, y: e.clientY };
    moved.current = false;
    setDrag({ x: 0, y: 0, active: true });
    if (card.expand) {
      holdTimer.current = setTimeout(() => {
        if (!moved.current) {
          setShowExpand(true);
          setDrag({ x: 0, y: 0, active: false });
          if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(10);
        }
      }, 380);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.active) return;
    const dx = e.clientX - startPos.current.x;
    const dy = e.clientY - startPos.current.y;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
      moved.current = true;
      if (holdTimer.current) clearTimeout(holdTimer.current);
    }
    if (Math.abs(dy) > Math.abs(dx) * 1.4) {
      setDrag({ x: 0, y: 0, active: false });
      return;
    }
    setDrag({ x: dx, y: dy, active: true });
  };

  const onPointerUp = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    if (!drag.active) return;
    const t = 110;
    if (drag.x < -t) {
      flyOut(-1);
    } else if (drag.x > t) {
      flyOut(1);
    } else {
      // Tap with no significant movement and no hold:
      //   email card → open the floating AI chat with this email loaded
      //   any card with href → client-side navigate
      if (!moved.current && !showExpand) {
        if (card.emailId) {
          const returnUrl = encodeURIComponent(
            window.location.pathname + window.location.search
          );
          router.push(
            `/command-center/email/${card.emailId}?returnUrl=${returnUrl}`
          );
        } else if (card.href) {
          router.push(card.href);
        }
      }
      setDrag({ x: 0, y: 0, active: false });
    }
  };

  const flyOut = (dir: 1 | -1) => {
    setDrag({ x: dir * 800, y: 40, active: false });
    setTimeout(() => onAction(dir > 0 ? "primary" : "secondary", card), 220);
  };

  if (dismissed) {
    return (
      <div className="rounded-2xl flex items-center justify-between px-4 py-3" style={{ background: v("bg-2"), border: `1px dashed ${v("line")}` }}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[13px]" style={{ color: v("quiet") }}>
            {dismissed === "primary" ? card.primary?.label ?? "Done" : card.secondary?.label ?? "Skipped"}
          </span>
          <span className="text-[14px] truncate" style={{ color: v("muted") }}>{card.title}</span>
        </div>
        <button onClick={() => onAction("undo", card)} className="text-[12px] font-semibold flex-shrink-0" style={{ color: v("accent") }}>
          Undo
        </button>
      </div>
    );
  }

  const transform = `translate3d(${drag.x}px, ${drag.y * 0.25}px, 0) rotate(${drag.x * 0.03}deg)`;
  const transition = drag.active ? "none" : "transform 220ms cubic-bezier(0.2, 0.7, 0.2, 1), opacity 220ms";
  const leftLabel  = drag.x < -20 ? Math.min(1, -drag.x / 110) : 0;
  const rightLabel = drag.x >  20 ? Math.min(1,  drag.x / 110) : 0;

  const borderColor = card.priority === "urgent" ? "rgba(239, 68, 68, 0.5)"
                    : card.priority === "high"   ? "rgba(217, 119, 6, 0.4)"
                    : v("line");
  const borderWidth = card.priority === "normal" ? "1px" : "1.5px";

  return (
    <div
      ref={cardRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className="relative rounded-2xl flex flex-col overflow-hidden select-none"
      style={{
        background: v("card"),
        border: `${borderWidth} solid ${borderColor}`,
        boxShadow: "0 2px 4px rgba(0,0,0,0.3)",
        transform,
        transition,
        touchAction: "pan-y",
      }}
    >
      <div
        className="absolute top-4 left-4 z-20 px-2.5 py-1 rounded text-[11px] font-bold uppercase pointer-events-none"
        style={{
          letterSpacing: "0.16em",
          background: "rgba(239, 68, 68, 0.2)", color: "#fca5a5", border: "1.5px solid #ef4444",
          opacity: leftLabel, transform: `rotate(-12deg) scale(${0.8 + leftLabel * 0.2})`,
        }}
      >
        {card.secondary?.label ?? "Skip"}
      </div>
      <div
        className="absolute top-4 right-4 z-20 px-2.5 py-1 rounded text-[11px] font-bold uppercase pointer-events-none"
        style={{
          letterSpacing: "0.16em",
          background: "rgba(217, 119, 6, 0.2)", color: "#fbbf24", border: `1.5px solid ${v("accent")}`,
          opacity: rightLabel, transform: `rotate(12deg) scale(${0.8 + rightLabel * 0.2})`,
        }}
      >
        Do it
      </div>

      <div className="flex items-center justify-between px-5 pt-4">
        <PriorityPill priority={card.priority} />
        {card.expand && (
          <span className="text-[10px] uppercase" style={{ color: v("quiet"), letterSpacing: "0.16em" }}>Hold for detail</span>
        )}
      </div>

      <div className="px-5 flex-1 flex flex-col">
        <CardBody card={card} />
      </div>

      <div className="px-4 pb-4 pt-3 flex flex-col gap-2" style={{ borderTop: `1px solid ${v("line-soft")}` }}>
        {card.primary && (
          <button
            onClick={() => onAction("primary", card)}
            className="w-full py-3.5 rounded-xl flex items-center justify-center gap-2 text-[15px] font-semibold transition active:scale-[0.98]"
            style={{ background: v("accent"), color: "#1a0f00" }}
          >
            <Icon name={card.primary.icon} />
            {card.primary.label}
          </button>
        )}
        <div className="flex gap-2">
          {card.secondary && (
            <button
              onClick={() => onAction("secondary", card)}
              className="flex-1 py-3 rounded-xl flex items-center justify-center gap-1.5 text-[14px] font-medium transition active:scale-[0.98]"
              style={{ background: v("bg-2"), color: v("ink"), border: `1px solid ${v("line")}` }}
            >
              <Icon name={card.secondary.icon} />
              {card.secondary.label}
            </button>
          )}
          {card.tertiary && (
            <button
              onClick={() => onAction("tertiary", card)}
              className="flex-1 py-3 rounded-xl flex items-center justify-center gap-1.5 text-[14px] font-medium transition active:scale-[0.98]"
              style={{ background: "transparent", color: v("muted"), border: `1px solid ${v("line")}` }}
            >
              <Icon name={card.tertiary.icon} />
              {card.tertiary.label}
            </button>
          )}
        </div>
      </div>

      {showExpand && card.expand && <ExpandSheet expand={card.expand} onClose={() => setShowExpand(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Today / Section / Schedule / Roster / Jobsites
// ---------------------------------------------------------------------------

function TodayStrip({ events }: { events: { time: string; what: string; tag: Priority; done: boolean }[] }) {
  const tagColor = (t: Priority) => t === "urgent" ? "#ef4444" : t === "high" ? v("accent") : v("quiet");
  return (
    <div className="rounded-2xl p-4" style={{ background: v("card"), border: `1px solid ${v("line")}` }}>
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <div className="text-[11px] font-medium uppercase" style={{ color: v("quiet"), letterSpacing: "0.18em" }}>Your day</div>
          <div className="text-[20px] font-semibold tracking-tight mt-0.5" style={{ color: v("ink") }}>
            {events.length} things on the calendar.
          </div>
        </div>
      </div>
      <div className="flex flex-col">
        {events.map((e, i) => (
          <div
            key={i}
            className="flex items-baseline gap-3 py-2.5"
            style={{ borderBottom: i < events.length - 1 ? `1px solid ${v("line-soft")}` : "none" }}
          >
            <div className="font-mono text-[12px] w-[42px] flex-shrink-0" style={{ color: v("muted"), fontVariantNumeric: "tabular-nums" }}>{e.time}</div>
            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5" style={{ background: tagColor(e.tag) }} />
            <div className="flex-1 text-[14px] leading-snug" style={{ color: v("ink") }}>{e.what}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 pt-3 pb-1 px-1">
      <div className="text-[11px] font-medium uppercase" style={{ color: v("quiet"), letterSpacing: "0.18em" }}>{label}</div>
      <div className="flex-1 h-px" style={{ background: v("line") }} />
    </div>
  );
}

function ScheduleCard({ items }: { items: { when: string; what: string }[] }) {
  return (
    <div className="rounded-2xl p-4" style={{ background: v("card"), border: `1px solid ${v("line")}` }}>
      <div className="text-[11px] font-medium uppercase mb-3" style={{ color: v("quiet"), letterSpacing: "0.18em" }}>Coming up</div>
      <div className="flex flex-col">
        {items.map((it, i) => (
          <div
            key={i}
            className="flex items-baseline gap-3 py-2.5"
            style={{ borderBottom: i < items.length - 1 ? `1px solid ${v("line-soft")}` : "none" }}
          >
            <div className="font-mono text-[11px] uppercase w-[110px] flex-shrink-0" style={{ color: v("quiet"), letterSpacing: "0.05em", fontVariantNumeric: "tabular-nums" }}>{it.when}</div>
            <div className="flex-1 text-[14px] leading-snug" style={{ color: v("ink") }}>{it.what}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmailInboxCard({ emails }: { emails: FeedEmailSummary[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const fetchGmail = async () => {
    setFetching(true);
    setMessage(null);
    try {
      const response = await fetch("/api/fetch-and-store-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 20 }),
      });
      const result = await response.json();
      if (!response.ok || result.error) {
        throw new Error(result.error || "Gmail sync failed");
      }
      setMessage(result.message);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Gmail sync failed");
    } finally {
      setFetching(false);
    }
  };

  const openEmail = (emailId: string) => {
    const returnUrl = encodeURIComponent("/command-center");
    setOpen(false);
    router.push(`/command-center/email/${emailId}?returnUrl=${returnUrl}`);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-2xl px-4 py-3.5 flex items-center gap-3 text-left transition active:scale-[0.99]"
        style={{ background: v("card"), border: `1px solid ${v("line")}` }}
        aria-haspopup="dialog"
      >
        <span
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: "rgba(217, 119, 6, 0.14)", color: v("accent") }}
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
            <rect x="2.5" y="4" width="15" height="12" rx="2" />
            <path d="m4 6 6 4.5L16 6" />
          </svg>
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[10px] font-medium uppercase" style={{ color: v("quiet"), letterSpacing: "0.18em" }}>
            Email
          </span>
          <span className="block text-[16px] font-semibold leading-tight mt-0.5" style={{ color: v("ink") }}>
            {emails.length === 0
              ? "Inbox is clear"
              : `${emails.length} message${emails.length === 1 ? "" : "s"} waiting`}
          </span>
        </span>
        <span className="text-[12px] font-semibold" style={{ color: v("accent") }}>
          Open
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-lg h-[82dvh] sm:h-[720px] p-0 gap-0 overflow-hidden flex flex-col">
          <DialogHeader className="px-4 py-4 border-b shrink-0">
            <div className="pr-8 flex items-center justify-between gap-3">
              <div>
                <DialogTitle>Email</DialogTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Recent messages that still need attention
                </p>
              </div>
              <Button
                onClick={fetchGmail}
                disabled={fetching}
                size="sm"
                className="bg-amber-600 hover:bg-amber-700 text-white"
              >
                {fetching ? "Fetching…" : "Fetch Gmail"}
              </Button>
            </div>
            {message && (
              <p className="text-xs text-muted-foreground pt-2">{message}</p>
            )}
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto divide-y">
            {emails.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-8">
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center mb-3"
                  style={{ background: "rgba(16, 185, 129, 0.12)", color: "#34d399" }}
                >
                  <Icon name="check" />
                </div>
                <p className="font-medium">All caught up</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Fetch Gmail to check for new messages.
                </p>
              </div>
            ) : (
              emails.map((email) => (
                <button
                  key={email.id}
                  type="button"
                  onClick={() => openEmail(email.id)}
                  className="w-full px-4 py-3.5 text-left hover:bg-muted/50 transition flex gap-3"
                >
                  <span
                    className="mt-1 w-2 h-2 rounded-full shrink-0"
                    style={{ background: email.urgent ? "#ef4444" : v("accent") }}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold truncate">{email.sender}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {new Date(email.date).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    </span>
                    <span className="block text-sm truncate mt-0.5">{email.subject}</span>
                    <span className="block text-xs text-muted-foreground truncate mt-1">
                      {email.snippet}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>

          <div className="p-3 border-t shrink-0">
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setOpen(false);
                router.push("/command-center/emails");
              }}
            >
              Open full inbox
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function TodoInboxCard({ todos }: { todos: FeedTodoSummary[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const visibleTodos = todos.filter((todo) => !hiddenIds.has(todo.id));

  const runTodoAction = async (
    todo: FeedTodoSummary,
    action: "done" | "snooze"
  ) => {
    setProcessingId(todo.id);
    setError(null);
    try {
      if (action === "done") {
        await updateTodoStatus(todo.id, "done");
      } else {
        await snoozeTodo(
          todo.id,
          new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        );
      }
      setHiddenIds((current) => new Set(current).add(todo.id));
      router.refresh();
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "Todo action failed"
      );
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-2xl px-4 py-3.5 flex items-center gap-3 text-left transition active:scale-[0.99]"
        style={{ background: v("card"), border: `1px solid ${v("line")}` }}
        aria-haspopup="dialog"
      >
        <span
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: "rgba(59, 130, 246, 0.13)", color: "#60a5fa" }}
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
            <rect x="3" y="3" width="14" height="14" rx="2" />
            <path d="m6.5 10 2.2 2.2 4.8-5" />
          </svg>
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[10px] font-medium uppercase" style={{ color: v("quiet"), letterSpacing: "0.18em" }}>
            Todos
          </span>
          <span className="block text-[16px] font-semibold leading-tight mt-0.5" style={{ color: v("ink") }}>
            {visibleTodos.length === 0
              ? "Nothing waiting"
              : `${visibleTodos.length} item${visibleTodos.length === 1 ? "" : "s"} waiting`}
          </span>
        </span>
        <span className="text-[12px] font-semibold" style={{ color: "#60a5fa" }}>
          Open
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-lg h-[82dvh] sm:h-[720px] p-0 gap-0 overflow-hidden flex flex-col">
          <DialogHeader className="px-4 py-4 border-b shrink-0">
            <DialogTitle>Todos</DialogTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Complete an item or snooze it until tomorrow
            </p>
            {error && <p className="text-xs text-red-400 pt-2">{error}</p>}
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto divide-y">
            {visibleTodos.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-8">
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center mb-3"
                  style={{ background: "rgba(16, 185, 129, 0.12)", color: "#34d399" }}
                >
                  <Icon name="check" />
                </div>
                <p className="font-medium">Nothing waiting</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Your open todos will appear here.
                </p>
              </div>
            ) : (
              visibleTodos.map((todo) => (
                <div key={todo.id} className="px-4 py-3.5">
                  <div className="flex gap-3">
                    <span
                      className="mt-1.5 w-2 h-2 rounded-full shrink-0"
                      style={{
                        background:
                          todo.priority === "urgent"
                            ? "#ef4444"
                            : todo.priority === "high"
                              ? v("accent")
                              : "#60a5fa",
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium leading-snug">
                        {todo.description}
                      </p>
                      <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground">
                        {todo.project && <span className="truncate">{todo.project}</span>}
                        {todo.dueDate && (
                          <span className="shrink-0">
                            Due{" "}
                            {new Date(todo.dueDate).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2 mt-3">
                        <Button
                          size="sm"
                          onClick={() => runTodoAction(todo, "done")}
                          disabled={processingId === todo.id}
                          className="bg-amber-600 hover:bg-amber-700 text-white"
                        >
                          Done
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => runTodoAction(todo, "snooze")}
                          disabled={processingId === todo.id}
                        >
                          Snooze 1 day
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="p-3 border-t shrink-0">
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setOpen(false);
                router.push("/command-center/todos");
              }}
            >
              Open all todos
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function JobsitesStrip({ sites, live }: { sites: Jobsite[]; live?: boolean }) {
  return (
    <div className="-mx-4 px-4">
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {sites.map((s) => <JobsiteCard key={s.id} site={s} live={live} />)}
      </div>
    </div>
  );
}

function JobsiteCard({ site, live }: { site: Jobsite; live?: boolean }) {
  return (
    <Link
      href={`/projects/${site.id}`}
      aria-label={`Open ${site.project}`}
      className="rounded-2xl p-4 flex-shrink-0 flex flex-col transition active:scale-[0.98]"
      style={{ background: v("card"), border: `1px solid ${v("line")}`, width: 260 }}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="text-[10px] font-medium uppercase" style={{ color: v("quiet"), letterSpacing: "0.18em" }}>{site.phase}</div>
        {live && site.crew.length > 0 && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase" style={{ color: "#34d399", letterSpacing: "0.12em" }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#10b981", boxShadow: "0 0 6px #10b981" }} />
            Live
          </span>
        )}
      </div>
      <div className="text-[16px] font-semibold tracking-tight leading-tight mb-1" style={{ color: v("ink"), textWrap: "balance" }}>{site.project}</div>
      <div className="text-[12px] leading-snug mb-3" style={{ color: v("muted") }}>{site.address}</div>
      <div className="rounded-lg overflow-hidden mb-3" style={{ background: v("bg-2"), height: 72 }}>
        <MiniMap />
      </div>
      <div className="flex items-center justify-between">
        <div className="flex -space-x-2">
          {site.crew.slice(0, 4).map((c) => <Avatar key={c} id={c} size={26} />)}
          {site.crew.length === 0 && (
            <div className="text-[12px] italic" style={{ color: v("quiet") }}>No crew today</div>
          )}
        </div>
        <div className="text-[11px] capitalize" style={{ color: v("muted"), fontVariantNumeric: "tabular-nums" }}>{site.status}</div>
      </div>
    </Link>
  );
}

function RosterCard({ entries, jobsites }: { entries: { siteId: string; crew: PersonId[]; lead: PersonId }[]; jobsites: Jobsite[] }) {
  return (
    <div className="rounded-2xl p-4" style={{ background: v("card"), border: `1px solid ${v("line")}` }}>
      <div className="text-[11px] font-medium uppercase mb-3" style={{ color: v("quiet"), letterSpacing: "0.18em" }}>Crew check</div>
      <div className="flex flex-col gap-3">
        {entries.map((e, i) => {
          const site = jobsites.find((j) => j.id === e.siteId);
          return (
            <div key={i} className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold truncate" style={{ color: v("ink") }}>{site?.project ?? e.siteId}</div>
                <div className="text-[12px] truncate" style={{ color: v("muted") }}>{site?.address}</div>
              </div>
              <div className="flex -space-x-2 flex-shrink-0">
                {e.crew.map((c) => <Avatar key={c} id={c} size={28} />)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Post / Metric
// ---------------------------------------------------------------------------

function PostPhoto({ tone }: { tone: "framing" | "wall" }) {
  const palette = tone === "wall"
    ? { sky: "oklch(0.42 0.06 240)", mid: "oklch(0.32 0.04 240)", fg: "oklch(0.65 0.10 60)" }
    : { sky: "oklch(0.50 0.08 50)",  mid: "oklch(0.32 0.06 40)",  fg: "oklch(0.22 0.04 50)" };
  return (
    <div className="aspect-[4/3] relative overflow-hidden" style={{ background: `linear-gradient(180deg, ${palette.sky}, ${palette.mid})` }}>
      <svg viewBox="0 0 400 300" className="absolute inset-0 w-full h-full">
        <path d="M0,200 L60,180 L130,195 L200,170 L280,185 L360,160 L400,175 L400,300 L0,300 Z" fill={palette.fg} opacity={0.4} />
        {tone === "wall" ? (
          <>
            <rect x={40} y={60} width={320} height={220} fill="oklch(0.35 0.04 50)" opacity={0.6} />
            {[60, 110, 160, 210, 260, 310, 360].map((x, i) => (
              <rect key={i} x={x - 4} y={60} width={8} height={220} fill="oklch(0.55 0.08 60)" opacity={0.85} />
            ))}
            <rect x={40} y={110} width={320} height={6} fill="oklch(0.55 0.08 60)" opacity={0.85} />
            <rect x={40} y={240} width={320} height={6} fill="oklch(0.55 0.08 60)" opacity={0.85} />
          </>
        ) : (
          <>
            <path d="M80,260 L80,140 L200,80 L320,140 L320,260 Z" fill="oklch(0.18 0.02 50)" opacity={0.85} />
            <path d="M80,260 L80,140 L200,80 L320,140 L320,260" stroke="oklch(0.65 0.14 60)" strokeWidth={2} fill="none" opacity={0.7} />
            {[120, 160, 200, 240, 280].map((x, i) => (
              <line key={i} x1={x} y1={160} x2={x} y2={260} stroke="oklch(0.6 0.10 60)" strokeWidth={2} opacity={0.7} />
            ))}
            <line x1={80} y1={200} x2={320} y2={200} stroke="oklch(0.6 0.10 60)" strokeWidth={2} opacity={0.7} />
          </>
        )}
      </svg>
      <div className="absolute bottom-2 left-3 text-[10px] font-mono uppercase" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "0.05em" }}>
        Site photo · auto-uploaded
      </div>
    </div>
  );
}

function PostCard({ post }: { post: Extract<FeedItem, { type: "post" }> }) {
  const [reactions, setReactions] = useState<Record<string, number>>(post.reactions ?? {});
  const [hasReacted, setHasReacted] = useState(false);

  const react = (emoji: string) => {
    setReactions((r) => ({ ...r, [emoji]: (r[emoji] ?? 0) + (hasReacted ? -1 : 1) }));
    setHasReacted((x) => !x);
  };

  if (post.kind === "milestone") {
    return (
      <div className="rounded-2xl p-4 flex items-start gap-3" style={{ background: "linear-gradient(135deg, rgba(217, 119, 6, 0.06), transparent)", border: "1px solid rgba(217, 119, 6, 0.25)" }}>
        <div className="w-9 h-9 rounded-full flex items-center justify-center text-[16px] flex-shrink-0" style={{ background: "rgba(217, 119, 6, 0.18)" }}>🎉</div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-medium uppercase" style={{ color: v("quiet"), letterSpacing: "0.18em" }}>{post.project} · {post.when}</div>
          <div className="text-[16px] font-semibold mt-0.5 leading-tight" style={{ color: v("ink") }}>{post.headline}</div>
          {post.sub && <div className="text-[13px] mt-1 leading-snug" style={{ color: v("muted") }}>{post.sub}</div>}
        </div>
      </div>
    );
  }

  const author = post.who ? PEOPLE[post.who] : undefined;

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: v("card"), border: `1px solid ${v("line")}` }}>
      <div className="px-4 pt-3.5 flex items-center gap-3">
        {post.who && <Avatar id={post.who} size={32} />}
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold leading-tight" style={{ color: v("ink") }}>
            {author?.name ?? post.who}
            {author?.role && <span style={{ color: v("quiet") }} className="font-normal"> · {author.role}</span>}
          </div>
          <div className="text-[11px] font-mono" style={{ color: v("quiet"), letterSpacing: "0.05em", fontVariantNumeric: "tabular-nums" }}>
            {post.project} · {post.when}
          </div>
        </div>
      </div>
      {post.text && <div className="px-4 pt-3 pb-3 text-[15px] leading-snug" style={{ color: v("ink") }}>{post.text}</div>}
      {post.photo && <PostPhoto tone={post.photo.tone} />}
      <div className="px-3 pt-2 pb-3 flex items-center gap-2" style={{ borderTop: `1px solid ${v("line-soft")}` }}>
        {(["👍", "🔥", "💪"] as const).map((e) => (
          <button
            key={e}
            onClick={() => react(e)}
            className="px-2.5 py-1 rounded-full flex items-center gap-1 text-[12px] transition active:scale-95"
            style={{
              background: reactions[e] ? "rgba(217, 119, 6, 0.14)" : v("bg-2"),
              border: `1px solid ${reactions[e] ? "rgba(217, 119, 6, 0.35)" : v("line")}`,
              color: reactions[e] ? v("accent") : v("muted"),
            }}
          >
            <span>{e}</span>
            {reactions[e] > 0 && <span className="font-semibold">{reactions[e]}</span>}
          </button>
        ))}
        <div className="ml-auto text-[11px] font-mono" style={{ color: v("quiet") }}>{post.project.slice(0, 18)}</div>
      </div>
    </div>
  );
}

function MetricCard({ metric }: { metric: Extract<FeedItem, { type: "metric" }> }) {
  return (
    <div className="rounded-2xl p-4" style={{ background: v("card"), border: `1px solid ${v("line")}` }}>
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-[11px] font-medium uppercase" style={{ color: v("quiet"), letterSpacing: "0.18em" }}>{metric.title}</div>
        {metric.side && <div className="text-[12px] font-mono" style={{ color: v("muted"), fontVariantNumeric: "tabular-nums" }}>{metric.side}</div>}
      </div>
      <div className="flex items-baseline gap-2 mb-2">
        <div className="text-[32px] font-semibold tracking-tight" style={{ color: v("ink"), fontVariantNumeric: "tabular-nums" }}>{metric.big}</div>
        <div className="text-[14px]" style={{ color: v("muted") }}>{metric.sub}</div>
      </div>
      {metric.sparkline && <Sparkline data={metric.sparkline} color={v("accent")} />}
      {metric.bars && (
        <div className="flex flex-col gap-1.5 mt-2">
          {metric.bars.map((b, i) => (
            <div key={i} className="flex items-center gap-2 text-[12px]">
              <div className="w-[68px]" style={{ color: v("muted") }}>{b.label}</div>
              <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: v("bg-2") }}>
                <div className="h-full rounded-full" style={{ width: `${b.value * 100}%`, background: v("accent"), opacity: 0.6 + i * 0.1 }} />
              </div>
              <div className="font-mono w-[32px] text-right" style={{ color: v("muted"), fontVariantNumeric: "tabular-nums" }}>{Math.round(b.value * 100)}%</div>
            </div>
          ))}
        </div>
      )}
      {metric.detail && <div className="text-[12px] mt-3 leading-snug" style={{ color: v("muted") }}>{metric.detail}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Daily log composer
// ---------------------------------------------------------------------------

type LogEntry = { id: string; text: string; time: string };

function DailyLogComposer({ placeholder }: { placeholder: string }) {
  const [draft, setDraft] = useState("");
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [focused, setFocused] = useState(false);

  const today = useMemo(
    () => new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
    []
  );

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    const time = new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    setEntries((prev) => [...prev, { id: crypto.randomUUID(), text, time }]);
    setDraft("");
    setFocused(false);
  };

  return (
    <div className="rounded-2xl p-4" style={{ background: v("card"), border: `1px solid ${v("line")}` }}>
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-[11px] font-medium uppercase" style={{ color: v("quiet"), letterSpacing: "0.18em" }}>
          Daily log · {today}
        </div>
        {entries.length > 0 && (
          <div className="text-[11px] font-mono" style={{ color: v("muted"), fontVariantNumeric: "tabular-nums" }}>
            {entries.length} {entries.length === 1 ? "note" : "notes"}
          </div>
        )}
      </div>
      <div className="text-[16px] font-semibold leading-tight tracking-tight mb-3" style={{ color: v("ink") }}>
        What did you accomplish today?
      </div>

      {entries.length > 0 && (
        <ul className="flex flex-col gap-2 mb-3">
          {entries.map((entry, i) => (
            <li
              key={entry.id}
              className="flex items-start gap-3 pt-2"
              style={{ borderTop: i === 0 ? "none" : `1px solid ${v("line-soft")}` }}
            >
              <span className="font-mono text-[11px] mt-1 w-[42px] flex-shrink-0" style={{ color: v("quiet"), fontVariantNumeric: "tabular-nums" }}>
                {entry.time}
              </span>
              <div className="flex-1 text-[14px] leading-snug whitespace-pre-wrap" style={{ color: v("ink") }}>
                {entry.text}
              </div>
              <button
                onClick={() => setEntries((prev) => prev.filter((e) => e.id !== entry.id))}
                aria-label="Remove note"
                className="opacity-40 hover:opacity-100 transition flex-shrink-0 mt-0.5"
                style={{ color: v("muted") }}
              >
                <Icon name="x" className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setFocused(true)}
        placeholder={placeholder}
        rows={focused || draft ? 3 : 2}
        className="w-full resize-none rounded-xl px-3 py-2.5 text-[14px] leading-snug transition outline-none"
        style={{
          background: v("bg-2"),
          color: v("ink"),
          border: `1px solid ${focused ? v("accent") : v("line")}`,
          fontFamily: "inherit",
        }}
      />

      <div className="flex items-center justify-between gap-2 mt-2.5">
        <div className="text-[11px]" style={{ color: v("quiet") }}>
          {draft.length === 0 ? "Add anything you got done — even small wins." : `${draft.length} chars`}
        </div>
        <button
          onClick={submit}
          disabled={!draft.trim()}
          className="px-3.5 py-2 rounded-lg flex items-center gap-1.5 text-[13px] font-semibold transition active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: v("accent"), color: "#1a0f00" }}
        >
          <Icon name="check" className="w-4 h-4" />
          Save log
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------

function EndOfFeed({ role }: { role: RoleId }) {
  const isField = role === "lead" || role === "crew";
  return (
    <div className="rounded-2xl p-6 mt-2 flex flex-col items-center text-center" style={{ background: v("bg-2"), border: `1px solid ${v("line-soft")}` }}>
      <div className="w-10 h-10 rounded-full flex items-center justify-center mb-3" style={{ background: "rgba(217, 119, 6, 0.14)", color: v("accent") }}>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
          <path d="M4 10l4 4 8-9" />
        </svg>
      </div>
      <div className="text-[16px] font-semibold mb-1" style={{ color: v("ink") }}>
        {isField ? "That's the lot." : "You're all caught up."}
      </div>
      <div className="text-[13px] max-w-[280px]" style={{ color: v("muted") }}>
        {isField ? "Build something good today." : "Pull-to-refresh for new updates."}
      </div>
    </div>
  );
}

type RenderItem = FeedItem | { type: "actionStack"; cards: ActionCardData[] };

function groupActionStacks(items: FeedItem[]): RenderItem[] {
  const out: RenderItem[] = [];
  for (const item of items) {
    if (item.type === "action") {
      const last = out[out.length - 1];
      if (last && last.type === "actionStack") {
        last.cards.push(item);
      } else {
        out.push({ type: "actionStack", cards: [item] });
      }
    } else {
      out.push(item);
    }
  }
  return out;
}

function TinderStack({ cards }: { cards: ActionCardData[] }) {
  const router = useRouter();
  const [history, setHistory] = useState<{ id: string; resolution: ActionResolution }[]>([]);
  const dismissedIds = useMemo(() => new Set(history.map((h) => h.id)), [history]);
  const remaining = cards.filter((c) => !dismissedIds.has(c.id));
  const visible = remaining.slice(0, 3);

  const handleAction = async (kind: ActionResolution | "undo", card: ActionCardData) => {
    if (kind === "undo") return;
    const resolution: ActionResolution = kind;
    setHistory((h) => [...h, { id: card.id, resolution }]);
    try {
      if (card.decisionId) {
        const fn = resolution === "primary" ? approveDecision : rejectDecision;
        const res = await fn(card.decisionId);
        if (!res.ok) {
          throw new Error(res.error ?? "Decision action failed");
        }
      } else if (card.emailId) {
        const fn = resolution === "primary" ? markEmailProcessed : dismissEmail;
        const res = await fn(card.emailId);
        if (!res.success) {
          throw new Error(res.error ?? "Email action failed");
        }
      } else if (card.id.startsWith("todo-")) {
        const todoId = card.id.slice("todo-".length);
        if (resolution === "primary") {
          await updateTodoStatus(todoId, "done");
        } else {
          const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
          await snoozeTodo(todoId, tomorrow.toISOString());
        }
      } else if (card.id.startsWith("quote-") && card.href) {
        router.push(card.href);
      }
    } catch (error) {
      setHistory((h) => h.filter((entry) => entry.id !== card.id));
      const message = error instanceof Error ? error.message : "Action failed";
      console.error("Command Center action failed:", error);
      alert(message);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 px-1">
        <div className="text-[11px] font-medium uppercase flex-shrink-0" style={{ color: v("quiet"), letterSpacing: "0.18em" }}>
          {history.length}/{cards.length} done
        </div>
        <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: v("bg-2") }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${(history.length / Math.max(cards.length, 1)) * 100}%`, background: v("accent") }}
          />
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-2xl p-8 flex flex-col items-center text-center" style={{ background: v("bg-2"), border: `1px dashed ${v("line")}` }}>
          <div className="w-10 h-10 rounded-full flex items-center justify-center mb-3" style={{ background: "rgba(217, 119, 6, 0.14)", color: v("accent") }}>
            <Icon name="check" />
          </div>
          <div className="text-[16px] font-semibold mb-1" style={{ color: v("ink") }}>Cleared the deck.</div>
          <div className="text-[13px]" style={{ color: v("muted") }}>
            Nothing else to handle right now.
          </div>
        </div>
      ) : (
        <div className="relative">
          {visible
            .slice()
            .reverse()
            .map((card, idxFromBack) => {
              const stackPos = visible.length - 1 - idxFromBack; // 0 = top
              const isTop = stackPos === 0;
              const transform = `translateY(${stackPos * 12}px) scale(${1 - stackPos * 0.04})`;
              const opacity = 1 - stackPos * 0.32;
              return (
                <div
                  key={card.id}
                  className={isTop ? "relative" : "absolute inset-0"}
                  style={{
                    transform,
                    opacity,
                    zIndex: 10 - stackPos,
                    pointerEvents: isTop ? "auto" : "none",
                    transition: "transform 250ms cubic-bezier(0.2, 0.7, 0.2, 1), opacity 250ms",
                    transformOrigin: "top center",
                  }}
                  aria-hidden={!isTop}
                >
                  <ActionCard card={card} onAction={isTop ? handleAction : () => {}} />
                </div>
              );
            })}
        </div>
      )}

      <div className="flex items-center justify-center gap-6 px-1 text-[10px] uppercase" style={{ color: v("quiet"), letterSpacing: "0.18em" }}>
        <span>← {visible[0]?.secondary?.label ?? "Skip"}</span>
        <span>Hold for detail</span>
        <span>{visible[0]?.primary?.label ?? "Done"} →</span>
      </div>
    </div>
  );
}

function SwipeSectionsTabs({ sections }: { sections: SwipeSection[] }) {
  const visible = sections.filter((s) => s.cards.length > 0);
  const [active, setActive] = useState<SwipeSectionId | null>(null);

  if (visible.length === 0) return null;

  const current = visible.find((s) => s.id === active) ?? visible[0];

  return (
    <div className="flex flex-col gap-3">
      <div
        className="flex items-center gap-1 p-1 rounded-2xl"
        style={{ background: v("bg-2"), border: `1px solid ${v("line")}` }}
      >
        {visible.map((s) => {
          const isActive = s.id === current.id;
          return (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              className="flex-1 px-3 py-2 rounded-xl text-[13px] font-semibold transition-colors flex items-center justify-center gap-2"
              style={{
                background: isActive ? v("accent") : "transparent",
                color: isActive ? "#1a0f00" : v("muted"),
              }}
            >
              <span className="truncate">{s.label}</span>
              <span
                className="text-[11px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center"
                style={{
                  background: isActive ? "rgba(26,15,0,0.18)" : v("bg-2"),
                  color: isActive ? "#1a0f00" : v("muted"),
                }}
              >
                {s.cards.length}
              </span>
            </button>
          );
        })}
      </div>
      <TinderStack key={current.id} cards={current.cards} />
    </div>
  );
}

function Feed({ items, role, jobsites, desktop }: { items: FeedItem[]; role: RoleId; jobsites: Jobsite[]; desktop?: boolean }) {
  const grouped = useMemo(() => groupActionStacks(items), [items]);

  const renderItem = (item: RenderItem) => {
    switch (item.type) {
      case "today":       return <TodayStrip   events={item.events} />;
      case "dailyLog":    return <DailyLogComposer placeholder={item.placeholder} />;
      case "todaysWork":  return <TodaysWorkCard phases={item.phases} />;
      case "weekSchedule":return <ScheduleStrip weekStart={item.weekStart} weekEnd={item.weekEnd} phases={item.phases} myEmployeeIds={item.myEmployeeIds} />;
      case "emailInbox":  return <EmailInboxCard emails={item.emails} />;
      case "todoInbox":   return <TodoInboxCard todos={item.todos} />;
      case "logPost":         return <DailyLogPost log={item.log} />;
      case "punchGroupPost":  return <PunchListGroupPost group={item.group} />;
      case "section":     return <SectionDivider label={item.label} />;
      case "actionStack": return <TinderStack  cards={item.cards} />;
      case "swipeSections": return <SwipeSectionsTabs sections={item.sections} />;
      case "jobsites":    return <JobsitesStrip sites={item.sites} live={item.live} />;
      case "roster":      return <RosterCard   entries={item.entries} jobsites={jobsites} />;
      case "post":        return <PostCard     post={item} />;
      case "metric":      return <MetricCard   metric={item} />;
      case "schedule":    return <ScheduleCard items={item.items} />;
      default:            return null;
    }
  };

  const itemKey = (item: RenderItem, idx: number): string | number => {
    if (item.type === "post" || item.type === "metric") return item.id;
    if (item.type === "logPost") return `log-${item.log.id}`;
    if (item.type === "punchGroupPost") return `punchg-${item.group.session_id}`;
    if (item.type === "actionStack") return `stack-${item.cards.map((c) => c.id).join("-")}`;
    return idx;
  };

  if (desktop) {
    const span = (item: RenderItem): string => {
      switch (item.type) {
        case "today":       return "col-span-12 lg:col-span-7";
        case "dailyLog":    return "col-span-12 lg:col-span-5";
        case "actionStack": return "col-span-12 lg:col-span-7";
        case "swipeSections": return "col-span-12 lg:col-span-7";
        case "todaysWork":  return "col-span-12";
        case "weekSchedule":return "col-span-12";
        case "emailInbox":  return "col-span-12";
        case "todoInbox":   return "col-span-12";
        case "logPost":         return "col-span-12 lg:col-span-6";
        case "punchGroupPost":  return "col-span-12 lg:col-span-6";
        case "post":        return "col-span-12 lg:col-span-6";
        case "metric":      return "col-span-12 lg:col-span-6";
        case "roster":      return "col-span-12";
        case "section":
        case "jobsites":
        case "schedule":
        default:            return "col-span-12";
      }
    };

    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-12 gap-5 items-start">
          {grouped.map((item, idx) => (
            <div key={itemKey(item, idx)} className={span(item)}>
              {renderItem(item)}
            </div>
          ))}
        </div>
        <EndOfFeed role={role} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {grouped.map((item, idx) => (
        <div key={itemKey(item, idx)}>{renderItem(item)}</div>
      ))}
      <EndOfFeed role={role} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header / Footer / Role switcher
// ---------------------------------------------------------------------------

function Greeting({ role }: { role: Role }) {
  const { tod, today } = useMemo(() => {
    const d = new Date();
    const hr = d.getHours();
    const t = hr < 12 ? "Morning" : hr < 17 ? "Afternoon" : "Evening";
    return {
      tod: t,
      today: d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }),
    };
  }, []);
  return (
    <div>
      <div className="text-[12px] font-mono uppercase" style={{ color: v("quiet"), letterSpacing: "0.05em" }}>{today}</div>
      <div className="text-[28px] sm:text-[32px] font-semibold tracking-tight mt-1.5 leading-tight" style={{ color: v("ink") }}>
        {tod}, <span style={{ color: v("accent") }}>{role.name}</span>.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Right rail (desktop ≥1280)
// ---------------------------------------------------------------------------

function RightRail({ role, jobsites }: { role: RoleId; jobsites: Jobsite[] }) {
  if (role === "crew") return null;
  if (jobsites.length === 0) return null;
  return (
    <aside
      className="hidden xl:flex h-full w-[320px] sticky top-0 overflow-y-auto px-5 py-7 flex-col gap-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{ borderLeft: `1px solid ${v("line")}` }}
    >
      <div>
        <div className="text-[10px] font-semibold uppercase mb-3" style={{ color: v("quiet"), letterSpacing: "0.18em" }}>Active jobsites</div>
        <div className="flex flex-col gap-2">
          {jobsites.map((s) => {
            const live = s.crew.length > 0;
            return (
              <div key={s.id} className="rounded-xl p-3 flex flex-col gap-2" style={{ background: v("card"), border: `1px solid ${v("line")}` }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[10px] font-mono uppercase" style={{ color: v("quiet"), letterSpacing: "0.05em" }}>{s.phase}</div>
                    <div className="text-[13px] font-semibold leading-tight mt-0.5 truncate" style={{ color: v("ink") }}>{s.project}</div>
                  </div>
                  {live && (
                    <span
                      className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded"
                      style={{ background: "rgba(52, 211, 153, 0.14)", color: "#34d399" }}
                    >
                      <span className="w-1 h-1 rounded-full" style={{ background: "currentColor" }} />
                      Live
                    </span>
                  )}
                </div>
                <div className="text-[11px] truncate" style={{ color: v("muted") }}>{s.address}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="text-[10px] text-center mt-auto pt-4" style={{ color: v("quiet") }}>
        Penney Construction · Local time
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/**
 * "Post update" — pick any active job, add photos + a note. Same flow the
 * field crew has on /crew; here so managers can drop job photos/notes from
 * the front page without a schedule phase or clock-in.
 */
function PostUpdateButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-3 rounded-2xl px-3.5 py-3 text-left transition active:scale-[0.99]"
        style={{
          background: "linear-gradient(180deg, rgba(217,119,6,0.07), rgba(0,0,0,0))",
          border: "1px solid rgba(217,119,6,0.28)",
        }}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: "rgba(217,119,6,0.16)" }}>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-[18px] h-[18px]" style={{ color: v("accent") }}>
            <path d="M4 6h3l1.5-2h3L13 6h3a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z" />
            <circle cx="10" cy="11" r="2.5" />
          </svg>
        </span>
        <span className="flex flex-col min-w-0 flex-1">
          <span className="text-[14px] font-medium" style={{ color: v("ink") }}>Post update</span>
          <span className="text-[11px] truncate" style={{ color: v("quiet") }}>Photos + notes on any job — no clock-in needed</span>
        </span>
      </button>
      {open && <JobClockInSheet intent="update" onClose={() => setOpen(false)} />}
    </>
  );
}

export function CommandCenterFeed({
  roleId,
  firstName,
  feed,
  jobsites,
}: {
  roleId: RoleId;
  firstName?: string | null;
  feed: FeedItem[];
  jobsites: Jobsite[];
}) {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const baseRole = ROLES.find((r) => r.id === roleId)!;
  const role: Role = firstName ? { ...baseRole, name: firstName } : baseRole;

  const wrapperStyle: CSSProperties = {
    ...TOKENS,
    background: v("bg"),
    color: v("ink"),
    fontFamily: "var(--font-geist-sans), -apple-system, sans-serif",
  };

  if (isDesktop) {
    return (
      <div className="min-h-screen w-full flex" style={wrapperStyle}>
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-[1320px] mx-auto px-8 py-8 flex flex-col gap-5">
            <Greeting role={role} />
            <GlobalSearch />
            <PostUpdateButton />
            <Feed items={feed} role={roleId} jobsites={jobsites} desktop />
          </div>
        </main>
        <RightRail role={roleId} jobsites={jobsites} />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center px-4 py-5 sm:py-6 pb-32" style={wrapperStyle}>
      <div className="w-full max-w-[460px] flex flex-col gap-4">
        <Greeting role={role} />
        <GlobalSearch />
        <PostUpdateButton />
        <Feed items={feed} role={roleId} jobsites={jobsites} />
      </div>
    </div>
  );
}
