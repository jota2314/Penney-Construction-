"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  RefreshCw, Sun, Moon, TrendingUp, ChevronLeft, ChevronRight,
  CalendarDays, Calculator, FileCheck, CheckCircle2, Sparkles,
  DollarSign, Mail, Bell, HardHat,
} from "lucide-react";
import type { CommandCenterV2Data } from "@/lib/actions/command-center-v2";
import type { HubMetrics } from "@/lib/actions/command-center-hub";

// ─── Icon map so DB-driven priorities can reference by string name ───
const ICONS = {
  FileCheck, CheckCircle2, Sparkles, DollarSign, Mail, Bell, HardHat,
  CalendarDays, Calculator,
} as const;

type IconKey = keyof typeof ICONS;

const fmtMoney = (n: number) => "$" + n.toLocaleString();
const fmtK = (n: number) => (n >= 1000 ? `$${(n / 1000).toFixed(0)}k` : `$${n}`);
const pct = (v: number, total: number) => (total > 0 ? ((v / total) * 100).toFixed(0) + "%" : "0%");

interface Weather { temp: number; emoji: string; label: string }

export function CommandCenterV2({
  data,
  hub,
  weather,
  dateStr,
  quarterLabel,
}: {
  data: CommandCenterV2Data;
  hub: HubMetrics;
  weather: Weather | null;
  dateStr: string;
  quarterLabel: string;
}) {
  // Pipeline values from HubMetrics fall back if v2 data is sparse
  const pipelineChips = [
    {
      label: "Estimates",
      icon: Calculator as typeof Calculator,
      main: (data.pipeline.estimates.draft + data.pipeline.estimates.review + data.pipeline.estimates.approved + data.pipeline.estimates.sent) || hub.estimates.total,
      sub: data.pipeline.estimates.totalValue > 0 ? fmtK(data.pipeline.estimates.totalValue) : `${hub.estimates.total} total`,
      tint: "violet" as const,
      href: "/estimates",
    },
    {
      label: "Quotes awaiting",
      icon: FileCheck as typeof Calculator,
      main: data.pipeline.quotes.awaiting || (hub.quotes.byStatus.awaiting_reply || 0),
      sub: `${data.pipeline.quotes.received} received`,
      tint: "teal" as const,
      href: "/command-center/quotes",
    },
    {
      label: "Quotes accepted",
      icon: CheckCircle2 as typeof Calculator,
      main: data.pipeline.quotes.accepted || (hub.quotes.byStatus.accepted || 0),
      sub: "this month",
      tint: "green" as const,
      href: "/command-center/quotes",
    },
    {
      label: "New leads",
      icon: Sparkles as typeof Calculator,
      main: data.pipeline.leadsThisWeek || hub.customers.newThisMonth,
      sub: "this week",
      tint: "amber" as const,
      href: "/projects?status=lead",
    },
  ];

  return (
    <div className="flex flex-1 flex-col min-w-0 overflow-auto bg-background">
      <div className="mx-auto w-full max-w-[1440px] px-6 py-6 sm:px-8 sm:py-7 pb-20">
        <CompanyHero
          data={data}
          weather={weather}
          dateStr={dateStr}
        />
        <CompanyMoneyPanel m={data.money} quarterLabel={quarterLabel} />
        <PipelineStrip chips={pipelineChips} />
        <ProjectRail projects={data.projects} />
        <WeekStrip week={data.week} todayIdx={data.todayIdx} />
        <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-4">
          <AttentionInbox items={data.attention} />
          <div className="flex flex-col gap-4">
            <StakeholderRail stakeholders={data.stakeholders} />
            <ActivityStream recent={data.recent} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// Hero
// ═════════════════════════════════════════════════════════════════
function CompanyHero({
  data, weather, dateStr,
}: {
  data: CommandCenterV2Data;
  weather: Weather | null;
  dateStr: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isDark, setIsDark] = useState(true);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 5) return "Working late";
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    if (h < 21) return "Good evening";
    return "Still at it";
  })();

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("dark", next);
    }
  };

  const refresh = () => {
    startTransition(() => router.refresh());
  };

  const healthColor = data.headline.healthStatus === "On pace" ? "bg-emerald-500"
    : data.headline.healthStatus === "Tight" ? "bg-amber-500"
    : data.headline.healthStatus === "Booked" ? "bg-sky-500"
    : "bg-zinc-400";

  return (
    <section className="pt-1 pb-5">
      <div className="flex justify-between items-center mb-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          {dateStr}
          {weather?.temp != null && (
            <span className="ml-3 normal-case tracking-normal text-muted-foreground/80">
              {weather.emoji} {Math.round(weather.temp)}°
              {weather.label ? ` · ${weather.label}` : ""}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={refresh}
            disabled={isPending}
            className="h-9 w-9 rounded-full border border-border bg-card grid place-items-center text-foreground hover:bg-muted disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${isPending ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={toggleTheme}
            className="h-9 w-9 rounded-full border border-border bg-card grid place-items-center text-foreground hover:bg-muted"
            title="Toggle theme"
          >
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <h1 className="font-serif italic font-medium text-[44px] leading-[1.05] tracking-tight my-4">
        {greeting}, <span className="text-amber-600 dark:text-amber-500 not-italic font-bold">Jorge</span>.
      </h1>

      <div className="flex items-baseline gap-3 flex-wrap">
        <div className="inline-flex items-center gap-1.5">
          <span className={`inline-block h-2 w-2 rounded-full ${healthColor}`} />
          <span className="text-[12.5px] text-muted-foreground font-medium">Penney Construction</span>
          <span className="text-[15px] font-semibold tabular-nums">{data.headline.healthStatus}</span>
        </div>
        <span className="text-border-strong text-muted-foreground/50">·</span>
        <div className="inline-flex items-baseline gap-1.5">
          <span className="text-[15px] font-semibold tabular-nums">{data.headline.active}</span>
          <span className="text-[12.5px] text-muted-foreground font-medium">active projects</span>
        </div>
        <span className="text-border-strong text-muted-foreground/50">·</span>
        <div className="inline-flex items-baseline gap-1.5">
          <span className="text-[15px] font-semibold tabular-nums">{fmtK(data.headline.inFlight)}</span>
          <span className="text-[12.5px] text-muted-foreground font-medium">in flight</span>
        </div>
        {data.headline.paceDeltaPct !== 0 && (
          <>
            <span className="text-border-strong text-muted-foreground/50">·</span>
            <div className="inline-flex items-baseline gap-1.5">
              <span className="inline-flex items-center gap-0.5 text-[13px] font-semibold text-emerald-600 dark:text-emerald-400">
                <TrendingUp className="h-3 w-3" />
                +{Math.round(data.headline.paceDeltaPct * 100)}%
              </span>
              <span className="text-[12.5px] text-muted-foreground font-medium">vs prior Q pace</span>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

// ═════════════════════════════════════════════════════════════════
// Money panel — stacked bar + margin/pipeline pills + Q target
// ═════════════════════════════════════════════════════════════════
function CompanyMoneyPanel({
  m, quarterLabel,
}: {
  m: CommandCenterV2Data["money"];
  quarterLabel: string;
}) {
  const totalForBar = Math.max(m.contract, 1);
  const qProgress = m.revenueQ2Target > 0 ? Math.min(1, m.revenueQ2ToDate / m.revenueQ2Target) : 0;

  return (
    <section className="bg-card border border-border rounded-2xl p-5 sm:p-6 mb-4 shadow-xs">
      <div className="flex justify-between items-start gap-3 mb-4 flex-wrap">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Cash across active projects
          </div>
          <h2 className="text-[18px] font-semibold tracking-tight leading-tight flex items-baseline gap-1 flex-wrap">
            <span className="text-[22px] font-bold tabular-nums">{fmtMoney(m.spent + m.committed)}</span>
            <span className="text-[15px] text-muted-foreground font-medium"> of {fmtMoney(m.contract)} contracted</span>
          </h2>
        </div>
        <div className="flex gap-2.5">
          <div className="px-3.5 py-2.5 rounded-lg border border-emerald-600/30 bg-emerald-500/10 flex flex-col gap-0.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{quarterLabel} margin</div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-[18px] font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                {(m.marginQ2 * 100).toFixed(0)}%
              </span>
              <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                <TrendingUp className="h-3 w-3" />
                +{(m.marginTrend * 100).toFixed(0)} pt
              </span>
            </div>
          </div>
          <div className="px-3.5 py-2.5 rounded-lg border border-border bg-muted/40 flex flex-col gap-0.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Pipeline</div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-[18px] font-bold tabular-nums">{fmtK(m.pipeline)}</span>
              <span className="text-[11px] text-muted-foreground font-medium">in proposals</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex h-[38px] rounded-lg overflow-hidden mb-2.5 ring-1 ring-black/5 dark:ring-white/5">
        <MoneySeg label={`Spent · ${fmtMoney(m.spent)}`} flex={m.spent / totalForBar} tone="spent" />
        <MoneySeg label={`Committed · ${fmtMoney(m.committed)}`} flex={m.committed / totalForBar} tone="committed" />
        <MoneySeg label={`Remaining · ${fmtMoney(m.remaining)}`} flex={m.remaining / totalForBar} tone="remaining" />
      </div>

      <div className="flex gap-4 flex-wrap items-center text-[11.5px] text-muted-foreground font-medium">
        <LegendDot tone="spent" label={`Spent ${pct(m.spent, m.contract)}`} />
        <LegendDot tone="committed" label={`Committed ${pct(m.committed, m.contract)}`} />
        <LegendDot tone="remaining" label={`Remaining ${pct(m.remaining, m.contract)}`} />
        <div className="ml-auto inline-flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{quarterLabel} target</span>
          <div className="w-[90px] h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-700"
              style={{ width: `${qProgress * 100}%` }}
            />
          </div>
          <span className="text-[12px] font-semibold tabular-nums">{Math.round(qProgress * 100)}%</span>
        </div>
      </div>
    </section>
  );
}

function MoneySeg({ label, flex, tone }: { label: string; flex: number; tone: "spent" | "committed" | "remaining" }) {
  const cls =
    tone === "spent" ? "bg-amber-600 text-white"
    : tone === "committed" ? "bg-amber-400/70 text-amber-950 dark:bg-amber-600/50 dark:text-amber-50"
    : "bg-muted text-muted-foreground";
  return (
    <div className={`flex items-center px-3 min-w-0 overflow-hidden whitespace-nowrap ${cls}`} style={{ flex: Math.max(flex, 0.001) }}>
      <span className="text-[11.5px] font-semibold tabular-nums">{label}</span>
    </div>
  );
}

function LegendDot({ tone, label }: { tone: "spent" | "committed" | "remaining"; label: string }) {
  const dot =
    tone === "spent" ? "bg-amber-600"
    : tone === "committed" ? "bg-amber-400/70 dark:bg-amber-600/50"
    : "bg-muted border border-border";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-sm ${dot}`} />
      {label}
    </span>
  );
}

// ═════════════════════════════════════════════════════════════════
// Pipeline strip
// ═════════════════════════════════════════════════════════════════
interface PipelineChip {
  label: string;
  icon: typeof Calculator;
  main: number;
  sub: string;
  tint: "violet" | "teal" | "green" | "amber";
  href: string;
}
function PipelineStrip({ chips }: { chips: PipelineChip[] }) {
  const tintClass = {
    violet: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
    teal: "bg-teal-500/15 text-teal-600 dark:text-teal-400",
    green: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    amber: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  };
  return (
    <section className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-4">
      {chips.map(c => {
        const Icon = c.icon;
        return (
          <Link
            key={c.label}
            href={c.href}
            className="bg-card border border-border rounded-xl px-4 py-3.5 flex items-center gap-3 shadow-xs hover:border-amber-500/40 hover:shadow-md hover:-translate-y-0.5 transition-all"
          >
            <div className={`h-9 w-9 rounded-lg grid place-items-center shrink-0 ${tintClass[c.tint]}`}>
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-baseline gap-1.5">
                <span className="text-[22px] font-bold tabular-nums tracking-tight leading-none">{c.main}</span>
                <span className="text-[11.5px] text-muted-foreground font-medium truncate">{c.sub}</span>
              </div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mt-0.5">
                {c.label}
              </div>
            </div>
          </Link>
        );
      })}
    </section>
  );
}

// ═════════════════════════════════════════════════════════════════
// Project rail
// ═════════════════════════════════════════════════════════════════
function ProjectRail({ projects }: { projects: CommandCenterV2Data["projects"] }) {
  if (projects.length === 0) {
    return (
      <section className="bg-card border border-border rounded-2xl p-5 mb-4 shadow-xs">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Active projects
        </div>
        <div className="text-sm text-muted-foreground mt-2">No active projects. <Link href="/projects" className="text-amber-600 hover:underline">Add one</Link>.</div>
      </section>
    );
  }
  return (
    <section className="bg-card border border-border rounded-2xl p-5 mb-4 shadow-xs">
      <div className="flex justify-between items-center gap-3 mb-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Active projects · {projects.length}
          </div>
          <h2 className="text-[15px] font-semibold tracking-tight">Status at a glance</h2>
        </div>
        <Link href="/projects" className="text-[12.5px] font-medium text-muted-foreground hover:text-foreground px-2.5 py-1 rounded-md hover:bg-muted">
          See all
        </Link>
      </div>
      <div className="grid gap-2.5 grid-cols-[repeat(auto-fill,minmax(230px,1fr))]">
        {projects.map(p => {
          const flagCls =
            p.flag === "urgent" ? "bg-red-500/15 text-red-600 dark:text-red-400"
            : p.flag === "high" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
            : "";
          return (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className="bg-muted/40 border border-transparent rounded-lg p-3.5 flex flex-col gap-2 hover:border-border/70 hover:-translate-y-0.5 transition-all"
            >
              <div className="flex justify-between items-center">
                <span className="font-mono text-[10px] tracking-wide text-muted-foreground/80">
                  {p.project_number || p.id.slice(0, 8)}
                </span>
                {p.flag && (
                  <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 capitalize ${flagCls}`}>
                    ● {p.flag}
                  </span>
                )}
              </div>
              <div className="text-[14px] font-semibold leading-tight tracking-tight">{p.name}</div>
              <div className="flex justify-between items-center">
                <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 bg-amber-500/15 text-amber-700 dark:text-amber-300 capitalize">
                  {p.phase || p.status.replace(/_/g, " ")}
                </span>
                <span className="font-mono text-[12.5px] text-muted-foreground tabular-nums">
                  {fmtK(p.contract_value)}
                </span>
              </div>
              <div className="h-1 bg-card rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-700"
                  style={{ width: `${p.progress * 100}%` }}
                />
              </div>
              {p.next_action && (
                <div className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground font-medium truncate">
                  <CalendarDays className="h-3 w-3 shrink-0" />
                  <span className="truncate">{p.next_action}</span>
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

// ═════════════════════════════════════════════════════════════════
// Week strip
// ═════════════════════════════════════════════════════════════════
function WeekStrip({
  week, todayIdx,
}: {
  week: CommandCenterV2Data["week"];
  todayIdx: number;
}) {
  const first = week[0]?.isoDate ? new Date(week[0].isoDate) : new Date();
  const last = week[week.length - 1]?.isoDate ? new Date(week[week.length - 1].isoDate) : new Date();
  const rangeLabel = `${first.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${last.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;

  return (
    <section className="bg-card border border-border rounded-2xl p-5 mb-4 shadow-xs">
      <div className="flex justify-between items-start gap-3 mb-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            This week
          </div>
          <h2 className="text-[18px] font-semibold tracking-tight">{rangeLabel}</h2>
        </div>
        <div className="flex gap-1">
          <button className="h-7 w-7 rounded-md bg-card border border-border grid place-items-center text-muted-foreground hover:bg-muted">
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button className="h-7 w-7 rounded-md bg-card border border-border grid place-items-center text-muted-foreground hover:bg-muted">
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-4 md:grid-cols-7 gap-2">
        {week.map((d, i) => {
          const isToday = i === todayIdx;
          const empty = d.items.length === 0;
          return (
            <div
              key={d.isoDate}
              className={`rounded-lg p-2.5 min-h-[130px] flex flex-col gap-2 border ${
                isToday
                  ? "bg-amber-500/15 border-amber-500 shadow-[0_0_0_3px_rgba(217,119,6,0.15)]"
                  : empty
                    ? "bg-muted/30 border-transparent opacity-55"
                    : "bg-muted/40 border-transparent"
              }`}
            >
              <div className="flex justify-between items-baseline border-b border-dashed border-border pb-1.5">
                <span className={`text-[10px] font-semibold uppercase tracking-wider ${isToday ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}>
                  {d.day}
                </span>
                <span className={`text-[16px] font-semibold leading-none ${isToday ? "text-amber-700 dark:text-amber-300" : "text-foreground"}`}>
                  {d.date}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                {d.items.length === 0 && (
                  <span className="text-muted-foreground/60 text-sm text-center py-3">—</span>
                )}
                {d.items.map((it, j) => (
                  <div key={j} className="bg-card rounded-md px-2 py-1.5 border-l-2 border-amber-500 flex flex-col gap-0.5">
                    <span className="text-[11px] font-semibold leading-tight">{it.title}</span>
                    <span className="text-[10px] text-muted-foreground font-medium">
                      {it.project}{it.tag ? " · " + it.tag : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ═════════════════════════════════════════════════════════════════
// Attention inbox
// ═════════════════════════════════════════════════════════════════
function AttentionInbox({ items }: { items: CommandCenterV2Data["attention"] }) {
  const priCls = (p: string) => {
    if (p === "urgent") return "bg-red-500/15 text-red-600 dark:text-red-400";
    if (p === "high") return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
    if (p === "medium") return "bg-yellow-400/15 text-yellow-700 dark:text-yellow-400";
    return "bg-muted text-muted-foreground";
  };
  const priLabel = (p: string) => p.charAt(0).toUpperCase() + p.slice(1);
  return (
    <section className="bg-card border border-border rounded-2xl p-5 shadow-xs">
      <div className="flex justify-between items-start gap-3 mb-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Needs attention
          </div>
          <h2 className="text-[18px] font-semibold tracking-tight">
            {items.length} items <span className="text-muted-foreground font-medium">for Jorge</span>
          </h2>
        </div>
        <Link href="/command-center/todos" className="text-[12.5px] font-medium text-muted-foreground hover:text-foreground px-2.5 py-1 rounded-md hover:bg-muted">
          View all
        </Link>
      </div>
      {items.length === 0 ? (
        <div className="text-sm text-muted-foreground py-4">Inbox zero — nothing flagged for you right now.</div>
      ) : (
        <ul className="flex flex-col gap-1 list-none p-0 m-0">
          {items.map((it, i) => {
            const Icon = ICONS[it.icon as IconKey] || Bell;
            return (
              <li
                key={i}
                className="grid grid-cols-[auto_1fr_auto] items-center gap-3.5 px-3 py-3 rounded-lg bg-muted/40 border border-transparent hover:border-border/70 hover:bg-muted transition-colors"
              >
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold min-w-[92px] justify-center ${priCls(it.priority)}`}>
                  <Icon className="h-3 w-3" />
                  {priLabel(it.priority)}
                </span>
                <div className="min-w-0">
                  <div className="text-[13.5px] font-medium leading-tight">{it.text}</div>
                  <div className="text-[11.5px] text-muted-foreground font-medium mt-0.5">{it.meta}</div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground/60" />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ═════════════════════════════════════════════════════════════════
// Stakeholders
// ═════════════════════════════════════════════════════════════════
function StakeholderRail({ stakeholders }: { stakeholders: CommandCenterV2Data["stakeholders"] }) {
  if (stakeholders.length === 0) return null;
  return (
    <section className="bg-card border border-border rounded-2xl p-5 shadow-xs">
      <div className="flex justify-between items-center gap-3 mb-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Stakeholders · {stakeholders.length}
        </div>
        <Link href="/subcontractors" className="text-[12.5px] font-medium text-muted-foreground hover:text-foreground px-2.5 py-1 rounded-md hover:bg-muted">
          Manage
        </Link>
      </div>
      <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
        {stakeholders.map((s, i) => (
          <div key={i} className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-muted/40">
            <div
              className="h-9 w-9 rounded-full grid place-items-center text-white font-semibold text-[11px] font-mono tracking-wide shrink-0"
              style={{ background: s.color }}
            >
              {s.avatar}
            </div>
            <div className="min-w-0 flex flex-col gap-px">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{s.role}</span>
              <span className="text-[12.5px] font-semibold truncate">{s.name}</span>
              <span className="text-[11px] text-muted-foreground/80 font-medium">{s.tag}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ═════════════════════════════════════════════════════════════════
// Activity stream
// ═════════════════════════════════════════════════════════════════
function ActivityStream({ recent }: { recent: CommandCenterV2Data["recent"] }) {
  if (recent.length === 0) return null;
  return (
    <section className="bg-card border border-border rounded-2xl p-5 shadow-xs">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        Recent activity
      </div>
      <ul className="flex flex-col gap-2.5 list-none p-0 m-0">
        {recent.map((r, i) => (
          <li key={i} className="grid grid-cols-[auto_1fr] gap-2.5 items-start">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 mt-2" />
            <div>
              <div className="text-[13px] font-medium leading-snug">{r.text}</div>
              <div className="text-[11px] text-muted-foreground font-medium mt-0.5">
                {r.when} · {r.by}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
