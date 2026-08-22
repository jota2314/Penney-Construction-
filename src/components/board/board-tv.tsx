"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CalendarOff, CloudRain, Package, Users } from "lucide-react";
import type { BoardData, BoardJob } from "@/lib/board/board-data";
import type { ProjectHealth } from "./job-board";

/**
 * Direction B — the wall.
 *
 * This is what runs on the TV in the shop: today only, type sized to be read
 * from across the room, and nothing that needs a mouse. Jobs with a crew on
 * them lead; the right rail carries what needs a person.
 *
 * Deliberately NOT a scaled-up Gantt. A timeline is for planning, which
 * happens at a desk. A wall answers "what is happening right now".
 */

interface Props {
  data: BoardData;
  health: Map<string, ProjectHealth>;
  onOpen: (projectId: string) => void;
}

/** Hours worth showing on a jobsite clock. */
const DAY_START = 6;
const DAY_END = 17;

function hourLabel(h: number) {
  if (h === 12) return "12p";
  return h > 12 ? `${h - 12}p` : `${h}a`;
}

function timeAgo(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function BoardTv({ data, health, onOpen }: Props) {
  const regional = data.weather[data.defaultSite] ?? {};
  const today = regional[data.todayStr];
  const hours = (data.hourly[data.defaultSite] ?? []).filter(
    (h) => h.hour >= DAY_START && h.hour <= DAY_END,
  );

  const [now, setNow] = useState<string>("");
  useEffect(() => {
    const tick = () =>
      setNow(
        new Date().toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        }),
      );
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  // Crews on site lead, then anything else in construction.
  const working = data.onsite.filter((j) => j.crewToday.length > 0);
  const quiet = data.onsite.filter((j) => j.crewToday.length === 0);
  const cards = [...working, ...quiet].slice(0, 9);

  const firstWetHour = hours.find((h) => h.wet);
  const exteriorAtRisk = data.onsite.flatMap((j) =>
    j.bars
      .filter((b) => b.risks.some((r) => r.date === data.todayStr))
      .map((b) => ({ job: j.name, phase: b.name })),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
      {/* ── Weather header ── */}
      <div className="flex flex-wrap items-start gap-6 rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-4">
          <span className="text-5xl leading-none" aria-hidden>
            {today?.icon ?? "·"}
          </span>
          <div>
            <div className="text-4xl font-semibold leading-none tabular-nums">
              {today ? `${today.high}°` : "—"}
            </div>
            <div className="text-sm text-muted-foreground">
              {today?.label ?? "No reading"} · North Shore
              {today ? ` · low ${today.low}°` : ""}
            </div>
          </div>
        </div>

        <div className="min-w-[320px] flex-1">
          {hours.length > 0 ? (
            <div className="flex overflow-hidden rounded border border-border">
              {hours.map((h) => (
                <div
                  key={h.hour}
                  className={`flex-1 border-r border-border/60 px-1 py-1.5 text-center last:border-r-0 ${
                    h.wet ? "bg-sky-500/15" : ""
                  }`}
                >
                  <div className="text-[11px] text-muted-foreground">{hourLabel(h.hour)}</div>
                  <div className="text-base leading-tight" aria-hidden>
                    {h.icon}
                  </div>
                  <div
                    className={`text-xs tabular-nums ${h.wet ? "text-sky-400" : "text-foreground"}`}
                  >
                    {h.temp}°
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Hourly forecast unavailable.</p>
          )}
          {firstWetHour && (
            <p className="flex items-center gap-1.5 pt-2 text-sm text-amber-500">
              <CloudRain className="h-4 w-4" aria-hidden />
              Wet from {hourLabel(firstWetHour.hour)}
              {exteriorAtRisk.length > 0 &&
                ` — ${exteriorAtRisk.length} exterior phase${exteriorAtRisk.length > 1 ? "s" : ""} outside today`}
            </p>
          )}
        </div>

        <div className="text-right">
          <div className="text-2xl font-semibold tabular-nums">{now}</div>
          <div className="text-xs text-muted-foreground">
            {new Date(`${data.todayStr}T00:00:00`).toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </div>
        </div>
      </div>

      {/* ── Job cards + needs-you rail ── */}
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1fr_280px]">
        <div className="grid content-start gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((job) => (
            <TvCard key={job.id} job={job} health={health.get(job.id)} onOpen={onOpen} />
          ))}
          {cards.length === 0 && (
            <p className="text-sm text-muted-foreground">No jobs in construction.</p>
          )}
        </div>

        <NeedsYou data={data} health={health} onOpen={onOpen} />
      </div>
    </div>
  );
}

function TvCard({
  job,
  health,
  onOpen,
}: {
  job: BoardJob;
  health: ProjectHealth | undefined;
  onOpen: (id: string) => void;
}) {
  const stripe =
    health?.health === "red"
      ? "border-l-red-500"
      : health?.health === "yellow"
        ? "border-l-amber-500"
        : "border-l-green-500";

  const todayBar = job.bars.find((b) => b.risks.length > 0) ?? job.bars[0];

  return (
    <button
      type="button"
      onClick={() => onOpen(job.id)}
      className={`flex flex-col gap-2 rounded-lg border border-l-4 border-border bg-card p-3 text-left hover:border-primary/50 ${stripe}`}
    >
      <div>
        <div className="text-base font-medium leading-tight">{job.name}</div>
        <div className="text-xs tabular-nums text-muted-foreground">
          {job.projectNumber}
          {todayBar ? ` · ${todayBar.name}` : job.phase ? ` · ${job.phase}` : ""}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {job.crewToday.length > 0 ? (
          <>
            <span className="flex -space-x-1">
              {job.crewToday.slice(0, 4).map((c) => (
                <span
                  key={c.id}
                  title={c.name}
                  className={`flex h-6 w-6 items-center justify-center rounded-full border border-card text-[10px] font-medium ${
                    c.clockedIn
                      ? "bg-green-500/25 text-green-300"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {c.initials}
                </span>
              ))}
            </span>
            <span className="rounded bg-green-500/15 px-1.5 py-0.5 text-[11px] text-green-400">
              {job.crewToday.length} on site
            </span>
          </>
        ) : (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
            {job.daysSinceLastLog === null
              ? "No field logs"
              : `Quiet ${job.daysSinceLastLog}d`}
          </span>
        )}
        {job.unscheduled && (
          <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] text-amber-500">
            <CalendarOff className="h-3 w-3" aria-hidden />
            Not scheduled
          </span>
        )}
      </div>

      {job.lastLog && (
        <p className="border-t border-border pt-2 text-xs leading-relaxed text-muted-foreground">
          <span className="line-clamp-2">&ldquo;{job.lastLog.text}&rdquo;</span>
          <span className="mt-0.5 block text-[11px] text-muted-foreground/70">
            {job.lastLog.author} · {timeAgo(job.lastLog.at)}
          </span>
        </p>
      )}
    </button>
  );
}

/**
 * The rail. Everything here is an actual open loop pulled from real rows —
 * overdue material orders, unsigned change orders, jobs that have gone quiet,
 * and exterior work sitting under rain.
 */
function NeedsYou({
  data,
  health,
  onOpen,
}: {
  data: BoardData;
  health: Map<string, ProjectHealth>;
  onOpen: (id: string) => void;
}) {
  const all = [...data.onsite, ...data.starting];

  const items: { id: string; projectId: string; text: string; tone: string }[] = [];

  for (const job of all) {
    for (const m of job.markers) {
      if (!m.overdue) continue;
      items.push({
        id: `${m.id}`,
        projectId: job.id,
        text: `${job.name} — ${m.kind === "order" ? "material past due" : "overdue"}: ${m.label}`,
        tone: "text-red-400",
      });
    }
    if (job.unsignedCoCount > 0) {
      items.push({
        id: `co-${job.id}`,
        projectId: job.id,
        text: `${job.name} — ${job.unsignedCoCount} change order${job.unsignedCoCount > 1 ? "s" : ""} unsigned`,
        tone: "text-red-400",
      });
    }
    if (job.status === "in_progress" && (job.daysSinceLastLog ?? 0) > 5) {
      items.push({
        id: `quiet-${job.id}`,
        projectId: job.id,
        text: `${job.name} — no field log in ${job.daysSinceLastLog} days`,
        tone: "text-amber-500",
      });
    }
    if (job.unscheduled) {
      items.push({
        id: `sched-${job.id}`,
        projectId: job.id,
        text: `${job.name} — in construction with nothing scheduled`,
        tone: "text-amber-500",
      });
    }
    const h = health.get(job.id);
    for (const issue of h?.health === "red" ? h.issues.slice(0, 1) : []) {
      items.push({
        id: `h-${job.id}`,
        projectId: job.id,
        text: `${job.name} — ${issue}`,
        tone: "text-red-400",
      });
    }
  }

  const wetAhead = data.onsite.flatMap((j) =>
    j.bars.flatMap((b) => b.risks.map((r) => ({ job: j.name, phase: b.name, ...r }))),
  );

  return (
    <aside className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Needs you
      </span>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
        {items.slice(0, 12).map((it) => (
          <button
            key={it.id}
            type="button"
            onClick={() => onOpen(it.projectId)}
            className={`flex items-start gap-1.5 text-left text-xs leading-snug ${it.tone} hover:underline`}
          >
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            <span>{it.text}</span>
          </button>
        ))}
        {items.length === 0 && (
          <p className="text-xs text-muted-foreground">Nothing open. Rare — enjoy it.</p>
        )}
      </div>

      {wetAhead.length > 0 && (
        <div className="border-t border-border pt-2">
          <span className="flex items-center gap-1.5 text-[11px] text-sky-400">
            <CloudRain className="h-3 w-3" aria-hidden />
            {wetAhead.length} exterior phase-day{wetAhead.length > 1 ? "s" : ""} under weather
          </span>
          <ul className="pt-1">
            {wetAhead.slice(0, 3).map((w, i) => (
              <li key={i} className="truncate text-[11px] text-muted-foreground">
                {w.job} · {w.phase} · {w.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-3 border-t border-border pt-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Users className="h-3 w-3" aria-hidden />
          {data.onsite.reduce((n, j) => n + j.crewToday.length, 0)} clocked in
        </span>
        <span className="flex items-center gap-1">
          <Package className="h-3 w-3" aria-hidden />
          {all.reduce((n, j) => n + j.markers.filter((m) => m.kind === "order").length, 0)} orders
        </span>
      </div>
    </aside>
  );
}
