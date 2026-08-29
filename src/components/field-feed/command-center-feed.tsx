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
import { MAX_SHIFT_MS } from "@/lib/crew/shift";
import { TodaysWorkCard } from "./todays-work-card";
import { DailyLogPost } from "./daily-log-post";
import { ScheduleStrip } from "./schedule-strip";
import { GlobalSearch } from "@/components/command-center/global-search";
import { JobClockInSheet } from "./job-clock-in-sheet";
import { CompanyPostComposer } from "./company-post-composer";
import { CompanyPostCard } from "./company-post-card";
import { ReceiptTile, DepositTile } from "./money-tiles";
import { NotificationBell } from "@/components/notifications/notification-bell";
import type { CompanyFeedPost } from "@/lib/actions/company-feed";
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
  /** Board lane: under construction vs signed-but-not-started. */
  stage?: "active" | "precon";
};

export type FeedLiveShift = {
  id: string;
  name: string;
  clockIn: string;
  /** Worker's rate in cents/hour — lets the client tick cost per second. */
  rateCentsPerHour: number;
  projectName: string | null;
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
  | { type: "liveMap"; activeShifts: FeedLiveShift[]; completedTodayCents: number; showSpend: boolean }
  | { type: "receiptCapture"; weekTotal: number; flaggedCount: number }
  | { type: "depositCapture"; weekTotal: number; flaggedCount: number }
  | { type: "logPost"; log: FeedDailyLog }
  | { type: "punchGroupPost"; group: FeedPunchGroup }
  | { type: "companyPost"; post: CompanyFeedPost }
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
  // This page is always dark regardless of app theme — pin the slim
  // scrollbar colors (globals.css) to the dark values here.
  "--scrollbar-thumb":       "rgba(255,255,255,0.14)",
  "--scrollbar-thumb-hover": "rgba(217,119,6,0.6)",
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

type UpdatesRange = "day" | "week";

function SectionDivider({
  label,
  range,
  onRangeChange,
}: {
  label: string;
  range?: UpdatesRange;
  onRangeChange?: (r: UpdatesRange) => void;
}) {
  if (label === "Company updates" || label === "From the field") {
    return (
      <div className="flex items-end justify-between gap-3 px-1 pb-1 pt-4">
        <div className="min-w-0">
          <h2 className="text-[18px] font-semibold tracking-tight" style={{ color: v("ink") }}>
            {label}
          </h2>
          <p className="mt-0.5 text-[11px]" style={{ color: v("quiet") }}>
            Posts, daily logs and jobsite updates ·{" "}
            {range === "day" ? "today" : range === "week" ? "this week" : "newest first"}
          </p>
        </div>
        {range && onRangeChange ? (
          <div
            className="flex shrink-0 items-center gap-1 p-0.5 rounded-lg mb-0.5"
            style={{ background: v("bg-2"), border: `1px solid ${v("line")}` }}
          >
            {(["day", "week"] as const).map((r) => (
              <button
                key={r}
                onClick={() => onRangeChange(r)}
                className="px-3 py-1 rounded-md text-[12px] font-semibold transition"
                style={{
                  background: range === r ? v("accent") : "transparent",
                  color: range === r ? "#1a0f00" : v("muted"),
                }}
              >
                {r === "day" ? "Day" : "Week"}
              </button>
            ))}
          </div>
        ) : (
          <span className="mb-1 h-1.5 w-1.5 rounded-full" style={{ background: v("accent"), boxShadow: `0 0 8px ${v("accent")}` }} />
        )}
      </div>
    );
  }

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

// Badge counts can exceed what fits in a compact tile — cap the display, not the data.
function fmtCount(n: number): string {
  return n > 99 ? "99+" : String(n);
}

/** Cost accrued so far by one open shift, in cents (capped at the 12h max). */
function shiftLiveCents(shift: FeedLiveShift, now: number): number {
  const ms = Math.min(Math.max(now - new Date(shift.clockIn).getTime(), 0), MAX_SHIFT_MS);
  return (ms / 3_600_000) * shift.rateCentsPerHour;
}

function LiveMapCard({
  activeShifts,
  completedTodayCents,
  showSpend,
  compact = false,
}: {
  activeShifts: FeedLiveShift[];
  completedTodayCents: number;
  showSpend: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  // Tick the clock every second while shifts are open so the counters count.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (activeShifts.length === 0 || !showSpend) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [activeShifts.length, showSpend]);

  useEffect(() => {
    router.prefetch("/command-center/map");
  }, [router]);

  const liveCents = activeShifts.reduce((sum, s) => sum + shiftLiveCents(s, now), 0);
  const todayTotal = (completedTodayCents + liveCents) / 100;
  const onClock = activeShifts.length;

  return (
    <>
      <button
        type="button"
        onClick={() => router.push("/command-center/map")}
        className={`w-full rounded-2xl text-left transition active:scale-[0.99] ${
          compact
            ? "flex min-w-0 flex-col items-center gap-1.5 px-2 py-2.5 text-center"
            : "flex items-center gap-3 px-4 py-3.5"
        }`}
        style={compact
          ? { background: "transparent" }
          : { background: v("card"), border: `1px solid ${v("line")}` }}
        aria-label={`Live map, ${onClock} on the clock`}
      >
        <span
          className={`${compact ? "h-8 w-8 rounded-lg" : "h-10 w-10 rounded-xl"} flex items-center justify-center shrink-0`}
          style={{ background: "rgba(16, 185, 129, 0.13)", color: "#34d399" }}
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
            <path d="M10 17.5s5.5-4.6 5.5-8.9a5.5 5.5 0 1 0-11 0c0 4.3 5.5 8.9 5.5 8.9Z" />
            <circle cx="10" cy="8.4" r="2" />
          </svg>
        </span>
        <span className={compact ? "min-w-0" : "flex-1 min-w-0"}>
          <span className="block text-[10px] font-medium uppercase" style={{ color: v("quiet"), letterSpacing: "0.18em" }}>
            Map
          </span>
          <span
            className={`mt-0.5 block font-semibold leading-tight ${compact ? "text-[20px]" : "text-[16px]"}`}
            style={{ color: onClock === 0 ? v("quiet") : v("ink") }}
          >
            {compact
              ? fmtCount(onClock)
              : onClock === 0
                ? "No one on the clock"
                : `${onClock} on the clock`}
            {!compact && showSpend && todayTotal > 0 && (
              <span
                className="font-mono"
                style={{ color: onClock > 0 ? "#f87171" : v("muted") }}
              >{` · $${todayTotal.toFixed(2)} today`}</span>
            )}
          </span>
          {compact && (
            showSpend && todayTotal > 0 ? (
              <span
                className="block text-[10px] font-mono font-semibold"
                style={{ color: onClock > 0 ? "#f87171" : v("quiet") }}
              >
                ${todayTotal.toFixed(2)}
              </span>
            ) : (
              <span className="block text-[10px] font-medium" style={{ color: v("quiet") }}>
                on the clock
              </span>
            )
          )}
        </span>
        <span className={compact ? "sr-only" : "text-[12px] font-semibold"} style={{ color: "#34d399" }}>
          Open
        </span>
      </button>
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

// Timestamp of a "Company updates" feed post, or null for every other item type.
function updatePostTs(item: FeedItem): number | null {
  if (item.type === "companyPost") return new Date(item.post.createdAt).getTime();
  if (item.type === "logPost") return new Date(item.log.started_at).getTime();
  if (item.type === "punchGroupPost") return new Date(item.group.created_at).getTime();
  return null;
}

// The id of the post/log/punch group behind a feed item, for deep-link focus.
function feedItemPostId(item: FeedItem): string | null {
  if (item.type === "companyPost") return item.post.id;
  if (item.type === "logPost") return item.log.id;
  if (item.type === "punchGroupPost") return item.group.session_id;
  return null;
}

// Post-type cards that share the two-column region of the desktop feed. CSS
// grid makes every row as tall as its tallest cell, so a 76px "clocked in"
// pill sitting beside a 900px photo post leaves a column of dead space. These
// get packed into balanced flex columns instead — see the masonry runs below.
const MASONRY_TYPES = new Set(["logPost", "punchGroupPost", "companyPost", "post", "metric"]);

// Rough rendered height, only used to decide which column a card lands in.
// Being off by a bit just shifts where the two columns end, never creates gaps.
function estimateHeight(item: RenderItem): number {
  switch (item.type) {
    case "logPost": {
      if (item.log.status === "in_progress") return 80; // live clock-in pill
      const media = item.log.photo_signed_urls.length > 0 ? 470 : 0;
      return 210 + media + item.log.comments.length * 56;
    }
    case "companyPost": {
      const media = item.post.photoUrls.length > 0 ? 470 : 0;
      return 210 + media + item.post.comments.length * 56;
    }
    case "punchGroupPost":
      return 150 + item.group.items.length * 92;
    case "metric":
      return 200;
    case "post":
      return item.photo ? 430 : 170;
    default:
      return 200;
  }
}

function Feed({ items, role, jobsites, desktop, focusPostId }: { items: FeedItem[]; role: RoleId; jobsites: Jobsite[]; desktop?: boolean; focusPostId?: string | null }) {
  const [updatesRange, setUpdatesRange] = useState<UpdatesRange>("week");

  const { visibleItems, hasVisibleUpdates, hasAnyUpdates } = useMemo(() => {
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    // Day = since local midnight; Week = today plus the previous 6 days.
    const cutoff = updatesRange === "day" ? dayStart : dayStart - 6 * 86400000;
    let any = false;
    let visible = false;
    const kept = items.filter((item) => {
      const ts = updatePostTs(item);
      if (ts === null) return true;
      any = true;
      // Always show the deep-linked post, even if it's older than the range —
      // otherwise a mention notification could land on an empty feed.
      if (focusPostId && feedItemPostId(item) === focusPostId) {
        visible = true;
        return true;
      }
      if (Number.isNaN(ts) || ts >= cutoff) {
        visible = true;
        return true;
      }
      return false;
    });
    return { visibleItems: kept, hasVisibleUpdates: visible, hasAnyUpdates: any };
  }, [items, updatesRange, focusPostId]);

  const grouped = useMemo(() => groupActionStacks(visibleItems), [visibleItems]);

  const renderItem = (item: RenderItem, compact = false) => {
    switch (item.type) {
      case "today":       return <TodayStrip   events={item.events} />;
      case "dailyLog":    return <DailyLogComposer placeholder={item.placeholder} />;
      case "todaysWork":  return <TodaysWorkCard phases={item.phases} />;
      case "weekSchedule":return <ScheduleStrip weekStart={item.weekStart} weekEnd={item.weekEnd} phases={item.phases} myEmployeeIds={item.myEmployeeIds} defaultCollapsed={!desktop} compact={!desktop} />;
      case "liveMap":     return <LiveMapCard activeShifts={item.activeShifts} completedTodayCents={item.completedTodayCents} showSpend={item.showSpend} compact={compact} />;
      case "receiptCapture": return <ReceiptTile weekTotal={item.weekTotal} flaggedCount={item.flaggedCount} compact={compact} />;
      case "depositCapture": return <DepositTile weekTotal={item.weekTotal} flaggedCount={item.flaggedCount} compact={compact} />;
      case "logPost":         return <DailyLogPost log={item.log} focus={focusPostId === item.log.id} linkProject />;
      case "punchGroupPost":  return <PunchListGroupPost group={item.group} />;
      case "companyPost":     return <CompanyPostCard post={item.post} focus={focusPostId === item.post.id} />;
      case "section":
        if (item.label === "Company updates" || item.label === "From the field") {
          return (
            <>
              <SectionDivider label={item.label} range={updatesRange} onRangeChange={setUpdatesRange} />
              {hasAnyUpdates && !hasVisibleUpdates && (
                <div
                  className="mt-2 rounded-2xl px-4 py-8 text-center"
                  style={{ background: v("card"), border: `1px dashed ${v("line")}`, color: v("muted") }}
                >
                  <div className="text-[13px]">
                    {updatesRange === "day" ? "Nothing posted today yet" : "Nothing posted this week"}
                  </div>
                  {updatesRange === "day" && (
                    <div className="text-[11px] opacity-70 mt-1">Switch to Week to see recent updates</div>
                  )}
                </div>
              )}
            </>
          );
        }
        return <SectionDivider label={item.label} />;
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
    if (item.type === "companyPost") return `company-${item.post.id}`;
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
        case "liveMap":     return "col-span-12";
        case "receiptCapture": return "col-span-12 lg:col-span-6";
        case "depositCapture": return "col-span-12 lg:col-span-6";
        case "logPost":         return "col-span-12 lg:col-span-6";
        case "punchGroupPost":  return "col-span-12 lg:col-span-6";
        case "companyPost":     return "col-span-12 lg:col-span-6";
        case "post":        return "col-span-12 lg:col-span-6";
        case "metric":      return "col-span-12 lg:col-span-6";
        case "roster":      return "col-span-12";
        case "section":
        case "jobsites":
        case "schedule":
        default:            return "col-span-12";
      }
    };

    // Collapse consecutive post-type cards into masonry runs; everything else
    // keeps its normal grid span so the 7/5 header split is untouched.
    type Block =
      | { kind: "single"; item: RenderItem; idx: number }
      | { kind: "masonry"; entries: { item: RenderItem; idx: number }[] };

    const blocks: Block[] = [];
    grouped.forEach((item, idx) => {
      if (MASONRY_TYPES.has(item.type)) {
        const last = blocks[blocks.length - 1];
        if (last?.kind === "masonry") last.entries.push({ item, idx });
        else blocks.push({ kind: "masonry", entries: [{ item, idx }] });
      } else {
        blocks.push({ kind: "single", item, idx });
      }
    });

    // Shortest-column-first packing keeps the two columns level without
    // reordering within a column (newest still reads top-down).
    const packColumns = (entries: { item: RenderItem; idx: number }[]) => {
      const cols: { item: RenderItem; idx: number }[][] = [[], []];
      const heights = [0, 0];
      for (const entry of entries) {
        const target = heights[1] < heights[0] ? 1 : 0;
        cols[target].push(entry);
        heights[target] += estimateHeight(entry.item);
      }
      return cols;
    };

    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-12 gap-5 items-start">
          {blocks.map((block, bIdx) =>
            block.kind === "single" ? (
              <div key={itemKey(block.item, block.idx)} className={span(block.item)}>
                {renderItem(block.item)}
              </div>
            ) : (
              <div key={`masonry-${bIdx}`} className="col-span-12 grid grid-cols-2 gap-5 items-start">
                {packColumns(block.entries).map((col, cIdx) => (
                  <div key={cIdx} className="flex flex-col gap-5">
                    {col.map(({ item, idx }) => (
                      <div key={itemKey(item, idx)}>{renderItem(item)}</div>
                    ))}
                  </div>
                ))}
              </div>
            ),
          )}
        </div>
        <EndOfFeed role={role} />
      </div>
    );
  }

  const inboxItems = grouped.filter(
    (item) =>
      item.type === "liveMap" ||
      item.type === "receiptCapture" ||
      item.type === "depositCapture",
  );
  const firstInboxItem = inboxItems[0];

  return (
    <div className="flex flex-col gap-2.5">
      {grouped.map((item, idx) => {
        const isInboxItem =
          item.type === "liveMap" ||
          item.type === "receiptCapture" ||
          item.type === "depositCapture";

        if (isInboxItem && item !== firstInboxItem) return null;

        if (item === firstInboxItem) {
          return (
            <div
              key="mobile-inbox-grid"
              className="grid grid-cols-3 overflow-hidden rounded-2xl"
              style={{ background: v("card"), border: `1px solid ${v("line")}` }}
            >
              {inboxItems.map((inboxItem, inboxIdx) => (
                <div
                  key={itemKey(inboxItem, inboxIdx)}
                  style={{ borderLeft: inboxIdx === 0 ? "none" : `1px solid ${v("line-soft")}` }}
                >
                  {renderItem(inboxItem, true)}
                </div>
              ))}
            </div>
          );
        }

        return <div key={itemKey(item, idx)}>{renderItem(item)}</div>;
      })}
      <EndOfFeed role={role} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header / Footer / Role switcher
// ---------------------------------------------------------------------------

function Greeting({ role, compact = false }: { role: Role; compact?: boolean }) {
  const { tod, today } = useMemo(() => {
    const d = new Date();
    const hourInNewYork = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        hourCycle: "h23",
      }).format(d),
    );
    const t = hourInNewYork < 12 ? "Morning" : hourInNewYork < 17 ? "Afternoon" : "Evening";
    return {
      tod: t,
      today: d.toLocaleDateString("en-US", {
        timeZone: "America/New_York",
        weekday: "long",
        month: "long",
        day: "numeric",
      }),
    };
  }, []);

  if (compact) {
    return (
      <div className="min-w-0">
        <div className="truncate text-[23px] font-semibold tracking-tight leading-tight" style={{ color: v("ink") }}>
          {tod}, <span style={{ color: v("accent") }}>{role.name}</span>
        </div>
        <div className="mt-1 truncate text-[10px] font-mono uppercase" style={{ color: v("quiet"), letterSpacing: "0.06em" }}>
          {today}
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <div className="text-[12px] font-mono uppercase" style={{ color: v("quiet"), letterSpacing: "0.05em" }}>{today}</div>
      <div className="mt-1.5 text-[28px] sm:text-[32px] font-semibold tracking-tight leading-tight" style={{ color: v("ink") }}>
        {tod}, <span style={{ color: v("accent") }}>{role.name}</span>.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Right rail (desktop ≥1280)
// ---------------------------------------------------------------------------

/** Footer clock — renders after mount to avoid a server/client hydration mismatch. */
function RailClock() {
  const [time, setTime] = useState<string | null>(null);
  useEffect(() => {
    const tick = () =>
      setTime(new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);
  return <>{time ? `Penney Construction · ${time}` : "Penney Construction"}</>;
}

function RailJobsiteCard({ site, accent, live }: { site: Jobsite; accent: string; live: boolean }) {
  return (
    <Link
      href={`/projects/${site.id}`}
      className="group relative rounded-xl p-3 pl-3.5 flex flex-col gap-1 overflow-hidden transition hover:brightness-[1.18] hover:shadow-[inset_0_0_0_1px_rgba(217,119,6,0.35)] active:scale-[0.99]"
      style={{ background: v("card"), border: `1px solid ${v("line")}` }}
    >
      <span aria-hidden className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: accent, opacity: live ? 1 : 0.6 }} />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-mono uppercase truncate" style={{ color: accent, letterSpacing: "0.05em" }}>{site.phase}</div>
          <div className="text-[13px] font-semibold leading-tight mt-0.5 truncate" style={{ color: v("ink") }}>{site.project}</div>
        </div>
        {live ? (
          <span
            className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded flex-shrink-0"
            style={{ background: "rgba(52, 211, 153, 0.14)", color: "#34d399" }}
          >
            <span className="w-1 h-1 rounded-full animate-pulse" style={{ background: "currentColor" }} />
            Live{site.crew.length > 0 ? ` · ${site.crew.join(", ")}` : ""}
          </span>
        ) : (
          <svg
            viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8}
            className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 opacity-0 -translate-x-0.5 group-hover:opacity-100 group-hover:translate-x-0 transition"
            style={{ color: v("accent") }}
          >
            <path d="M7 4l6 6-6 6" />
          </svg>
        )}
      </div>
      <div className="text-[11px] truncate" style={{ color: v("muted") }}>{site.address}</div>
    </Link>
  );
}

function RightRail({ role, jobsites }: { role: RoleId; jobsites: Jobsite[] }) {
  if (role === "crew") return null;
  if (jobsites.length === 0) return null;

  // Three lanes: crew on the clock, under construction, signed-not-started.
  const lanes = [
    { key: "live", label: "On site now", accent: "#34d399", sites: jobsites.filter((s) => s.crew.length > 0) },
    { key: "active", label: "In progress", accent: "#D97706", sites: jobsites.filter((s) => s.crew.length === 0 && (s.stage ?? "active") === "active") },
    { key: "precon", label: "Pre-construction", accent: "#8A8378", sites: jobsites.filter((s) => s.crew.length === 0 && s.stage === "precon") },
  ].filter((l) => l.sites.length > 0);

  return (
    <aside
      className="hidden xl:flex h-full w-[320px] sticky top-0 overflow-y-auto px-5 flex-col"
      style={{ borderLeft: `1px solid ${v("line")}` }}
    >
      <div className="sticky top-0 z-10 -mx-5 px-5 pt-7 pb-3" style={{ background: v("bg") }}>
        <div className="flex items-baseline justify-between">
          <div className="text-[10px] font-semibold uppercase" style={{ color: v("quiet"), letterSpacing: "0.18em" }}>Active jobsites</div>
          <div
            className="text-[10px] font-mono px-1.5 py-0.5 rounded-md"
            style={{ color: v("muted"), background: v("bg-2"), fontVariantNumeric: "tabular-nums" }}
          >
            {jobsites.length}
          </div>
        </div>
      </div>

      {lanes.map((lane) => (
        <div key={lane.key} className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: lane.accent }} />
            <span className="text-[10px] font-medium uppercase whitespace-nowrap" style={{ color: v("muted"), letterSpacing: "0.14em" }}>{lane.label}</span>
            <span className="text-[10px] font-mono" style={{ color: v("quiet"), fontVariantNumeric: "tabular-nums" }}>{lane.sites.length}</span>
            <span className="flex-1 h-px" style={{ background: v("line-soft") }} />
          </div>
          <div className="flex flex-col gap-2">
            {lane.sites.map((s) => (
              <RailJobsiteCard key={s.id} site={s} accent={lane.accent} live={lane.key === "live"} />
            ))}
          </div>
        </div>
      ))}

      <div className="text-[10px] text-center mt-auto pt-4 pb-6" style={{ color: v("quiet") }}>
        <RailClock />
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
function PostUpdateButton({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        type="button"
        aria-label="Create a new daily log"
        className={`${compact ? "h-11 w-11 justify-center rounded-xl" : "w-full gap-3 rounded-2xl px-3.5 py-3"} flex items-center text-left transition active:scale-[0.99]`}
        style={compact
          ? { background: "transparent" }
          : {
              background: "linear-gradient(180deg, rgba(217,119,6,0.07), rgba(0,0,0,0))",
              border: "1px solid rgba(217,119,6,0.28)",
            }}
      >
        <span className={`flex shrink-0 items-center justify-center ${compact ? "h-10 w-10 rounded-full" : "h-9 w-9 rounded-xl"}`} style={{ background: "rgba(217,119,6,0.16)", border: "1px solid rgba(217,119,6,0.24)" }}>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-[18px] h-[18px]" style={{ color: v("accent") }}>
            <path d="M4 6h3l1.5-2h3L13 6h3a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z" />
            <circle cx="10" cy="11" r="2.5" />
          </svg>
        </span>
        <span className={compact ? "sr-only" : "flex flex-col min-w-0 flex-1"}>
          <span className="text-[14px] font-medium" style={{ color: v("ink") }}>New daily log</span>
          <span className="text-[11px] truncate" style={{ color: v("quiet") }}>Take jobsite photos and add notes</span>
        </span>
      </button>
      {open && <JobClockInSheet intent="update" onClose={() => setOpen(false)} />}
    </>
  );
}

function FieldComposer({
  role,
  onPosted,
}: {
  role: Role;
  onPosted: (post: CompanyFeedPost) => void;
}) {
  const router = useRouter();
  const [intent, setIntent] = useState<"company" | "update" | "punch" | null>(null);

  return (
    <>
      <section
        className="overflow-hidden rounded-[22px]"
        style={{
          background: v("card"),
          border: `1px solid ${v("line")}`,
          boxShadow: "0 12px 32px -28px rgba(0,0,0,0.9)",
        }}
        aria-label="Create a company post or field record"
      >
        <button
          type="button"
          onClick={() => setIntent("company")}
          className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition active:bg-white/[0.03]"
          aria-label="Create a company post"
        >
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
            style={{ background: "linear-gradient(145deg, #B45309, #7C2D12)", border: "1px solid rgba(255,255,255,0.12)" }}
          >
            {role.name.slice(0, 1).toUpperCase()}
          </span>
          <span
            className="flex min-w-0 flex-1 items-center rounded-full px-4 py-2.5 text-[13px]"
            style={{ background: v("bg-2"), border: `1px solid ${v("line")}`, color: v("muted") }}
          >
            Share something with the team…
          </span>
        </button>
        <div className="grid grid-cols-4 px-2 pb-2" style={{ borderTop: `1px solid ${v("line-soft")}` }}>
          <button
            type="button"
            onClick={() => setIntent("company")}
            className="mt-2 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-[11px] font-semibold transition active:bg-white/[0.04]"
            style={{ color: v("muted") }}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4" style={{ color: "#60A5FA" }} aria-hidden="true">
              <path d="M4 4h12v9H8l-4 3V4z" />
            </svg>
            Company
          </button>
          <button
            type="button"
            onClick={() => setIntent("update")}
            className="mt-2 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-[11px] font-semibold transition active:bg-white/[0.04]"
            style={{ borderLeft: `1px solid ${v("line-soft")}`, color: v("muted") }}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} className="h-[17px] w-[17px]" style={{ color: "#34D399" }} aria-hidden="true">
              <rect x="3" y="5" width="14" height="11" rx="2" />
              <path d="M6 5l1.5-2h5L14 5M7 11l2-2 4 4 2-2 2 2" />
            </svg>
            Daily log
          </button>
          <button
            type="button"
            onClick={() => setIntent("punch")}
            className="mt-2 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-[11px] font-semibold transition active:bg-white/[0.04]"
            style={{ borderLeft: `1px solid ${v("line-soft")}`, color: v("muted") }}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-[17px] w-[17px]" style={{ color: "#F59E0B" }} aria-hidden="true">
              <rect x="3" y="3" width="14" height="14" rx="2" />
              <path d="m6.5 8 1.5 1.5L10.5 7M12 8h2M6.5 13 8 14.5l2.5-2.5M12 13h2" />
            </svg>
            Punch list
          </button>
          <button
            type="button"
            onClick={() => router.push("/meetings/new")}
            className="mt-2 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-[11px] font-semibold transition active:bg-white/[0.04]"
            style={{ borderLeft: `1px solid ${v("line-soft")}`, color: v("muted") }}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-[17px] w-[17px]" style={{ color: "#A78BFA" }} aria-hidden="true">
              <rect x="7" y="2.5" width="6" height="10" rx="3" />
              <path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5M7.5 17.5h5" />
            </svg>
            Meeting
          </button>
        </div>
      </section>
      {intent === "company" && (
        <CompanyPostComposer
          open
          authorName={role.name}
          onOpenChange={(open) => {
            if (!open) setIntent(null);
          }}
          onPosted={onPosted}
        />
      )}
      {(intent === "update" || intent === "punch") && (
        <JobClockInSheet
          intent={intent}
          onClose={() => setIntent(null)}
        />
      )}
    </>
  );
}

export function CommandCenterFeed({
  roleId,
  firstName,
  feed,
  jobsites,
  focusPostId,
}: {
  roleId: RoleId;
  firstName?: string | null;
  feed: FeedItem[];
  jobsites: Jobsite[];
  /** Post/log id to scroll to and open comments for (from a mention link). */
  focusPostId?: string | null;
}) {
  const router = useRouter();
  const [isDesktop, setIsDesktop] = useState(false);
  // Company posts published this session, rendered at the top of the feed
  // immediately (with local photo previews) while router.refresh() fetches
  // the server copy.
  const [pendingPosts, setPendingPosts] = useState<CompanyFeedPost[]>([]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Once the refreshed feed contains the real post, the local copy stops
  // rendering (filtered out below) — reclaim its blob preview URLs so the
  // underlying photo files can be garbage-collected. Revoking an
  // already-revoked URL is a no-op, so re-runs are harmless.
  useEffect(() => {
    for (const post of pendingPosts) {
      const reconciled = feed.some(
        (item) => item.type === "companyPost" && item.post.id === post.id,
      );
      if (!reconciled) continue;
      for (const url of post.photoUrls) {
        if (url.startsWith("blob:")) URL.revokeObjectURL(url);
      }
    }
  }, [feed, pendingPosts]);

  const handlePosted = (post: CompanyFeedPost) => {
    setPendingPosts((current) => [post, ...current.filter((p) => p.id !== post.id)]);
    router.refresh();
  };

  const baseRole = ROLES.find((r) => r.id === roleId)!;
  const role: Role = firstName ? { ...baseRole, name: firstName } : baseRole;

  // The schedule renders above the post composer, so pull it out of the feed.
  const scheduleItem = feed.find(
    (i): i is Extract<FeedItem, { type: "weekSchedule" }> => i.type === "weekSchedule",
  );
  const baseFeedItems = scheduleItem ? feed.filter((i) => i.type !== "weekSchedule") : feed;

  // Splice this session's not-yet-reconciled posts in at the top of the
  // updates section (before the first update post, else right after the
  // "Company updates" divider).
  const freshPending = pendingPosts.filter(
    (post) =>
      !baseFeedItems.some((item) => item.type === "companyPost" && item.post.id === post.id),
  );
  let feedItems = baseFeedItems;
  if (freshPending.length > 0) {
    const pendingItems: FeedItem[] = freshPending.map((post) => ({ type: "companyPost", post }));
    const firstUpdateIdx = baseFeedItems.findIndex((item) => updatePostTs(item) !== null);
    const sectionIdx = baseFeedItems.findIndex(
      (item) => item.type === "section" && item.label === "Company updates",
    );
    const insertAt =
      firstUpdateIdx >= 0 ? firstUpdateIdx : sectionIdx >= 0 ? sectionIdx + 1 : baseFeedItems.length;
    feedItems = [
      ...baseFeedItems.slice(0, insertAt),
      ...pendingItems,
      ...baseFeedItems.slice(insertAt),
    ];
  }

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
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <Greeting role={role} />
              </div>
              <NotificationBell />
            </div>
            <GlobalSearch />
            {scheduleItem && (
              <ScheduleStrip
                weekStart={scheduleItem.weekStart}
                weekEnd={scheduleItem.weekEnd}
                phases={scheduleItem.phases}
                myEmployeeIds={scheduleItem.myEmployeeIds}
              />
            )}
            <FieldComposer role={role} onPosted={handlePosted} />
            <Feed items={feedItems} role={roleId} jobsites={jobsites} desktop focusPostId={focusPostId} />
          </div>
        </main>
        <RightRail role={roleId} jobsites={jobsites} />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center px-3.5 pt-6 sm:pt-7 pb-32" style={wrapperStyle}>
      <div className="w-full max-w-[460px] flex flex-col gap-2.5">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <Greeting role={role} compact />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <NotificationBell />
            <GlobalSearch compact />
            <PostUpdateButton compact />
          </div>
        </div>
        {scheduleItem && (
          <ScheduleStrip
            weekStart={scheduleItem.weekStart}
            weekEnd={scheduleItem.weekEnd}
            phases={scheduleItem.phases}
            myEmployeeIds={scheduleItem.myEmployeeIds}
            defaultCollapsed
            compact
          />
        )}
        <FieldComposer role={role} onPosted={handlePosted} />
        <Feed items={feedItems} role={roleId} jobsites={jobsites} focusPostId={focusPostId} />
      </div>
    </div>
  );
}
