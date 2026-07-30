import Link from "next/link";
import {
  Mountain,
  Wrench,
  ListChecks,
  AlertTriangle,
  CheckCircle2,
  Circle,
  CalendarClock,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StartMeetingButton } from "@/components/eos/start-meeting-button";
import { getEosContext, getEosOverview } from "@/lib/eos/queries";
import {
  ROCK_STATUS_CLASSES,
  ROCK_STATUS_LABELS,
  formatMeasurable,
  formatWeekLabel,
  isOnGoal,
  weekEnding,
} from "@/lib/constants/eos";
import { cn } from "@/lib/utils";
import { notFound } from "next/navigation";

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export default async function EosOverviewPage() {
  const ctx = await getEosContext();
  if (!ctx) notFound();

  const overview = await getEosOverview(ctx);
  const thisWeek = weekEnding();

  const rocksOnTrack = overview.rocks.filter(
    (r) => r.status === "on_track" || r.status === "complete",
  ).length;
  const rocksTotal = overview.rocks.length;

  const scored = overview.measurables.filter(
    (m) => m.scores[thisWeek] !== undefined && m.scores[thisWeek] !== null,
  );
  const onGoal = scored.filter(
    (m) => isOnGoal(m.scores[thisWeek], m.goalTarget, m.comparison) === true,
  ).length;

  return (
    <>
      {/* ── Header row ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">{overview.quarter}</h2>
          <p className="text-sm text-muted-foreground">
            {ctx.team.meetingDay !== null
              ? `Level 10 every ${DAY_NAMES[ctx.team.meetingDay]}${
                  ctx.team.meetingTime ? ` at ${ctx.team.meetingTime.slice(0, 5)}` : ""
                }`
              : "Same day, same time, every week — set your L10 slot on the Level 10 tab."}
          </p>
        </div>
        <StartMeetingButton
          liveMeetingId={overview.liveMeeting?.id ?? null}
          todayDoneId={overview.todayDone?.id ?? null}
        />
      </div>

      {overview.liveMeeting && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
          </span>
          <span className="font-medium text-amber-500">
            A Level 10 is running right now
          </span>
        </div>
      )}

      {/* ── Stat tiles ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          href="/eos/rocks"
          icon={Mountain}
          label="Rocks on track"
          value={rocksTotal ? `${rocksOnTrack}/${rocksTotal}` : "—"}
          tone={
            rocksTotal === 0
              ? "muted"
              : rocksOnTrack === rocksTotal
                ? "good"
                : "bad"
          }
        />
        <StatTile
          href="/eos/scorecard"
          icon={CheckCircle2}
          label={`On goal (wk ${formatWeekLabel(thisWeek)})`}
          value={scored.length ? `${onGoal}/${scored.length}` : "No numbers yet"}
          tone={
            scored.length === 0 ? "muted" : onGoal === scored.length ? "good" : "bad"
          }
        />
        <StatTile
          href="/eos/issues"
          icon={Wrench}
          label="Open issues"
          value={String(overview.openIssues)}
          tone="muted"
        />
        <StatTile
          href="/eos/todos"
          icon={ListChecks}
          label="Open to-dos"
          value={
            overview.overdueTodos
              ? `${overview.openTodos} · ${overview.overdueTodos} late`
              : String(overview.openTodos)
          }
          tone={overview.overdueTodos ? "bad" : "muted"}
        />
      </div>

      {/* ── Rocks + scorecard ──────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Rocks — {overview.quarter}</CardTitle>
            <Link
              href="/eos/rocks"
              className="text-xs font-medium text-amber-500 hover:underline"
            >
              Manage
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {overview.rocks.length === 0 && (
              <EmptyNote>
                No Rocks for {overview.quarter} yet. Rocks agreed in session
                can be refined to be more SMART, but not added or removed.
              </EmptyNote>
            )}
            {overview.rocks.map((rock) => (
              <div
                key={rock.id}
                className="flex items-start justify-between gap-3 rounded-lg border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{rock.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {rock.ownerName ?? "Unassigned"}
                    {rock.dueDate ? ` · due ${rock.dueDate}` : ""}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={cn("shrink-0 text-[10px]", ROCK_STATUS_CLASSES[rock.status])}
                >
                  {ROCK_STATUS_LABELS[rock.status]}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">
              Scorecard — week ending {formatWeekLabel(thisWeek)}
            </CardTitle>
            <Link
              href="/eos/scorecard"
              className="text-xs font-medium text-amber-500 hover:underline"
            >
              Enter numbers
            </Link>
          </CardHeader>
          <CardContent className="space-y-1">
            {overview.measurables.length === 0 && (
              <EmptyNote>No measurables on the scorecard yet.</EmptyNote>
            )}
            {overview.measurables.map((m) => {
              const value = m.scores[thisWeek] ?? null;
              const hit = isOnGoal(value, m.goalTarget, m.comparison);
              return (
                <div
                  key={m.id}
                  className="flex items-center justify-between gap-3 border-b py-1.5 last:border-0"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {hit === null ? (
                      <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
                    ) : hit ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-500" />
                    )}
                    <span className="truncate text-sm">{m.name}</span>
                  </div>
                  <div className="shrink-0 text-right">
                    <span
                      className={cn(
                        "text-sm font-medium tabular-nums",
                        hit === false && "text-red-500",
                        hit === true && "text-emerald-500",
                      )}
                    >
                      {formatMeasurable(value, m.unit)}
                    </span>
                    <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
                      {m.goalTarget === null
                        ? "goal TBD"
                        : `${m.comparison} ${formatMeasurable(m.goalTarget, m.unit)}`}
                    </span>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {/* ── Last meeting ───────────────────────────────────────── */}
      {overview.lastMeeting && (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="h-4 w-4" />
              Last Level 10 — {overview.lastMeeting.meetingDate}
            </CardTitle>
            <Link
              href={`/eos/meetings/${overview.lastMeeting.id}`}
              className="text-xs font-medium text-amber-500 hover:underline"
            >
              Open
            </Link>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              Rating{" "}
              <span className="font-semibold tabular-nums">
                {overview.lastMeeting.avgRating ?? "—"}
              </span>
              <span className="text-muted-foreground"> / 10</span>
            </p>
            {overview.lastMeeting.cascadingMessage && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Cascading message
                </p>
                <p className="whitespace-pre-wrap">
                  {overview.lastMeeting.cascadingMessage}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-sm text-muted-foreground">{children}</p>;
}

function StatTile({
  href,
  icon: Icon,
  label,
  value,
  tone,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  value: string;
  tone: "good" | "bad" | "muted";
}) {
  return (
    <Link
      href={href}
      className="rounded-xl border bg-card p-4 transition-colors hover:border-amber-500/50"
    >
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p
        className={cn(
          "mt-2 text-2xl font-semibold tabular-nums",
          tone === "good" && "text-emerald-500",
          tone === "bad" && "text-red-500",
        )}
      >
        {value}
      </p>
    </Link>
  );
}
