"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  DollarSign,
  Users,
  Pencil,
  Check,
  X,
  Coffee,
  AlertTriangle,
  Loader2,
  MapPin,
  MessageSquare,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { StatTile } from "@/components/crew-admin/stat-tile";
import { Button } from "@/components/ui/button";
import {
  getPayrollTimesheet,
  setPayrollBreak,
  updateTimeEntry,
  type PayrollTimesheet,
  type PayrollEntry,
  type PayrollUpdate,
} from "@/lib/actions/payroll";

/* ------------------------------- date helpers ------------------------------ */

/** Local YYYY-MM-DD for a Date. */
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Monday of the week containing `d`. */
function mondayOf(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function dayParts(dateStr: string): { weekday: string; date: string } {
  // Anchor at noon so timezone never shifts the calendar date.
  const d = new Date(`${dateStr}T12:00:00`);
  return {
    weekday: d.toLocaleDateString("en-US", { weekday: "short" }),
    date: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
  };
}

function fmtRange(startStr: string, endStr: string): string {
  const s = new Date(`${startStr}T12:00:00`);
  const e = new Date(`${endStr}T12:00:00`);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${s.toLocaleDateString("en-US", opts)} – ${e.toLocaleDateString("en-US", { ...opts, year: "numeric" })}`;
}

function fmtClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** ISO instant → value for a <input type="datetime-local"> in browser-local time. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 16);
}

function fmtHM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

function fmtDec(minutes: number): string {
  return (minutes / 60).toFixed(2);
}

function fmtMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

/** Deterministic chip palette per project so each job keeps its color. */
const PROJECT_CHIP_STYLES = [
  "bg-sky-500/15 text-sky-400 border-sky-500/25",
  "bg-violet-500/15 text-violet-400 border-violet-500/25",
  "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  "bg-rose-500/15 text-rose-400 border-rose-500/25",
  "bg-cyan-500/15 text-cyan-400 border-cyan-500/25",
  "bg-orange-500/15 text-orange-400 border-orange-500/25",
  "bg-lime-500/15 text-lime-400 border-lime-500/25",
  "bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/25",
] as const;

function projectChipStyle(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PROJECT_CHIP_STYLES[h % PROJECT_CHIP_STYLES.length];
}

/* -------------------------------- component -------------------------------- */

export function PayrollTimesheet() {
  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(new Date()));
  const [sheet, setSheet] = useState<PayrollTimesheet | null>(null);
  const [loading, startLoad] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const start = ymd(weekStart);
  const end = ymd(addDays(weekStart, 6));

  const load = useCallback(() => {
    // All state updates happen inside the async transition callback (never
    // synchronously in the effect) so we don't trigger cascading renders.
    startLoad(async () => {
      const res = await getPayrollTimesheet(start, end);
      if (res.error) {
        setError(res.error);
        setSheet(null);
      } else if (res.data) {
        setError(null);
        setSheet(res.data);
      }
    });
  }, [start, end]);

  useEffect(() => {
    load();
  }, [load]);

  const isThisWeek = ymd(mondayOf(new Date())) === start;

  return (
    <div className="space-y-5">
      {/* Week navigation */}
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setWeekStart((w) => addDays(w, -7))}
          aria-label="Previous week"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="text-center">
          <p className="text-sm font-semibold">{fmtRange(start, end)}</p>
          <button
            onClick={() => setWeekStart(mondayOf(new Date()))}
            className="text-[11px] text-amber-500 hover:underline disabled:opacity-40"
            disabled={isThisWeek}
          >
            {isThisWeek ? "This week" : "Jump to this week"}
          </button>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setWeekStart((w) => addDays(w, 7))}
          aria-label="Next week"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <StatTile
          icon={Users}
          iconClassName="text-green-500"
          value={String(sheet?.totals.workerCount ?? 0)}
          label="Workers with hours"
        />
        <StatTile
          icon={Clock}
          iconClassName="text-amber-500"
          valueClassName="text-amber-500"
          value={sheet ? fmtHM(sheet.totals.paidMinutes) : "0h 0m"}
          label="Paid hours"
        />
        <StatTile
          icon={DollarSign}
          iconClassName="text-red-400"
          valueClassName="text-red-400"
          value={sheet ? fmtMoney(sheet.totals.costCents) : "$0"}
          label="Labor cost"
        />
      </div>

      {sheet && sheet.totals.missingRateWorkers > 0 && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-xs text-amber-500">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {sheet.totals.missingRateWorkers} worker
          {sheet.totals.missingRateWorkers > 1 ? "s have" : " has"} no hourly rate set — their
          cost shows as $0. Set a rate on the Crew Roster.
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      {loading && !sheet && (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}

      {sheet && sheet.workers.length === 0 && !loading && (
        <Card className="p-8 text-center text-muted-foreground">
          <Clock className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No clock-ins for this week.</p>
        </Card>
      )}

      {/* Per-worker cards */}
      <div className="space-y-3">
        {sheet?.workers.map((w) => (
          <Card key={w.profileId} className="overflow-hidden p-0">
            <div className="flex items-center justify-between gap-3 px-4 py-3 bg-muted/40 border-b border-border/60">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-9 w-9 shrink-0 rounded-full bg-gradient-to-br from-amber-500/30 to-amber-700/30 border border-amber-500/30 flex items-center justify-center text-xs font-bold text-amber-500">
                  {initials(w.name)}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold truncate">{w.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {w.hourlyRate != null ? `$${w.hourlyRate}/hr` : "No rate set"}
                  </p>
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-lg font-bold text-amber-500">{fmtHM(w.totalPaidMinutes)}</p>
                <p className="text-[11px] text-muted-foreground">
                  {fmtDec(w.totalPaidMinutes)} hrs
                  {w.hourlyRate != null && ` · ${fmtMoney(w.costCents)}`}
                </p>
              </div>
            </div>

            <div className="divide-y divide-border/60 px-4">
              {w.days.map((day) => (
                <DayRow
                  key={day.date}
                  profileId={w.profileId}
                  date={day.date}
                  entries={day.entries}
                  updates={day.updates}
                  rawMinutes={day.rawMinutes}
                  breakMinutes={day.breakMinutes}
                  paidMinutes={day.paidMinutes}
                  breakOverridden={day.breakOverridden}
                  hasOpen={day.hasOpen}
                  onChanged={load}
                />
              ))}
            </div>
          </Card>
        ))}
      </div>

      {sheet && (
        <p className="text-[11px] text-muted-foreground text-center">
          Break defaults to 30 min per worker per day — tap the break value to change it. Times
          shown in local time.
        </p>
      )}
    </div>
  );
}

/* --------------------------------- day row --------------------------------- */

function DayRow({
  profileId,
  date,
  entries,
  updates,
  rawMinutes,
  breakMinutes,
  paidMinutes,
  breakOverridden,
  hasOpen,
  onChanged,
}: {
  profileId: string;
  date: string;
  entries: PayrollEntry[];
  updates: PayrollUpdate[];
  rawMinutes: number;
  breakMinutes: number;
  paidMinutes: number;
  breakOverridden: boolean;
  hasOpen: boolean;
  onChanged: () => void;
}) {
  const [editingBreak, setEditingBreak] = useState(false);
  const [breakVal, setBreakVal] = useState(String(breakMinutes));
  const [editEntryId, setEditEntryId] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [rowError, setRowError] = useState<string | null>(null);

  const { weekday, date: dateLabel } = dayParts(date);

  const saveBreak = () => {
    const mins = Number(breakVal);
    startSave(async () => {
      const res = await setPayrollBreak(profileId, date, mins);
      if (res.error) {
        setRowError(res.error);
        return;
      }
      setRowError(null);
      setEditingBreak(false);
      onChanged();
    });
  };

  return (
    <div className="py-3">
      {/* Day header: date left, break + paid right */}
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-baseline gap-1.5">
          <span className="text-sm font-semibold">{weekday}</span>
          <span className="text-xs text-muted-foreground">{dateLabel}</span>
          {hasOpen && (
            <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-green-500/15 px-2 py-0.5 text-[9px] font-semibold uppercase text-green-500">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
              on clock
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {/* Break */}
          {editingBreak ? (
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={0}
                max={720}
                value={breakVal}
                onChange={(ev) => setBreakVal(ev.target.value)}
                className="w-12 rounded border border-border bg-background px-1 py-0.5 text-xs text-right"
                autoFocus
              />
              <button onClick={saveBreak} disabled={saving} aria-label="Save break" className="text-green-500">
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              </button>
              <button
                onClick={() => {
                  setEditingBreak(false);
                  setBreakVal(String(breakMinutes));
                }}
                aria-label="Cancel"
                className="text-muted-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                setBreakVal(String(breakMinutes));
                setEditingBreak(true);
              }}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              title="Edit break"
            >
              <Coffee className="h-3 w-3" />
              <span className={breakOverridden ? "text-amber-500 font-medium" : ""}>{breakMinutes}m</span>
            </button>
          )}
          <div className="text-right w-16">
            <p className="text-sm font-semibold leading-tight">{fmtHM(paidMinutes)}</p>
            {rawMinutes !== paidMinutes && (
              <p className="text-[10px] text-muted-foreground line-through leading-tight">
                {fmtHM(rawMinutes)}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Shift entries. Zero-length completed rows are the old clock-out-note
          logs — render them as work notes, not clock time. */}
      <div className="space-y-1.5">
        {entries.map((e) => {
          const isNoteOnly = !!e.clockOut && e.rawMinutes === 0;
          if (isNoteOnly && editEntryId !== e.id) {
            return (
              <div key={e.id} className="group flex items-start gap-1.5 text-[11px] text-muted-foreground">
                <MessageSquare className="h-3 w-3 mt-0.5 shrink-0 text-amber-500/70" />
                <p className="min-w-0">
                  {e.note ? <span className="italic">{e.note}</span> : <span className="italic opacity-60">No note</span>}
                  {e.projectName && <span className="text-foreground/60"> — {e.projectName}</span>}
                  <span className="text-foreground/40"> · {fmtClock(e.clockIn)}</span>
                  <button
                    onClick={() => setEditEntryId(e.id)}
                    className="ml-1.5 inline-flex align-middle opacity-0 group-hover:opacity-60 hover:!opacity-100"
                    aria-label="Edit times"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                </p>
              </div>
            );
          }
          return editEntryId === e.id ? (
            <EntryEditor
              key={e.id}
              entry={e}
              saving={saving}
              onCancel={() => setEditEntryId(null)}
              onSave={(inIso, outIso) =>
                startSave(async () => {
                  const res = await updateTimeEntry(e.id, inIso, outIso);
                  if (res.error) {
                    setRowError(res.error);
                    return;
                  }
                  setRowError(null);
                  setEditEntryId(null);
                  onChanged();
                })
              }
            />
          ) : (
            <div key={e.id} className="group">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span className={`tabular-nums ${e.clockOut ? "text-foreground/90" : "text-green-500 font-medium"}`}>
                  {fmtClock(e.clockIn)} {e.clockOut ? `– ${fmtClock(e.clockOut)}` : "– (still in)"}
                </span>
                {e.projectName && (
                  <span
                    className={`inline-flex max-w-[180px] items-center gap-1 truncate rounded-full border px-2 py-0.5 text-[10px] font-medium ${projectChipStyle(e.projectName)}`}
                    title={e.projectNumber ? `${e.projectNumber} · ${e.projectName}` : e.projectName}
                  >
                    <MapPin className="h-2.5 w-2.5 shrink-0" />
                    <span className="truncate">{e.projectName}</span>
                  </span>
                )}
                {e.autoClockedOut && (
                  <span className="text-[9px] uppercase font-semibold text-amber-500/80">auto</span>
                )}
                {e.edited && (
                  <span className="text-[9px] uppercase font-semibold text-blue-400/80">edited</span>
                )}
                <button
                  onClick={() => setEditEntryId(e.id)}
                  className="opacity-40 hover:opacity-100"
                  aria-label="Edit times"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              </div>
              {e.note && (
                <p className="mt-0.5 pl-1 text-[11px] text-muted-foreground italic border-l-2 border-border/60 ml-1.5 pl-2">
                  {e.note}
                </p>
              )}
            </div>
          );
        })}

        {/* Field updates (Post update logs) — what they did, not clock time */}
        {updates.map((u) => (
          <div key={u.id} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <MessageSquare className="h-3 w-3 mt-0.5 shrink-0 text-amber-500/70" />
            <p className="min-w-0">
              <span className="italic">{u.text}</span>
              {u.projectName && <span className="text-foreground/60"> — {u.projectName}</span>}
              <span className="text-foreground/40"> · {fmtClock(u.at)}</span>
            </p>
          </div>
        ))}
      </div>

      {rowError && <p className="text-[11px] text-red-400 mt-1">{rowError}</p>}
    </div>
  );
}

/* ------------------------------- entry editor ------------------------------ */

function EntryEditor({
  entry,
  saving,
  onSave,
  onCancel,
}: {
  entry: PayrollEntry;
  saving: boolean;
  onSave: (clockInIso: string, clockOutIso: string | null) => void;
  onCancel: () => void;
}) {
  const [inVal, setInVal] = useState(toLocalInput(entry.clockIn));
  const [outVal, setOutVal] = useState(entry.clockOut ? toLocalInput(entry.clockOut) : "");

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <input
        type="datetime-local"
        value={inVal}
        onChange={(e) => setInVal(e.target.value)}
        className="rounded border border-border bg-background px-1 py-0.5 text-xs"
      />
      <span className="text-muted-foreground">–</span>
      <input
        type="datetime-local"
        value={outVal}
        onChange={(e) => setOutVal(e.target.value)}
        className="rounded border border-border bg-background px-1 py-0.5 text-xs"
      />
      <button
        onClick={() => onSave(new Date(inVal).toISOString(), outVal ? new Date(outVal).toISOString() : null)}
        disabled={saving || !inVal}
        className="text-green-500 disabled:opacity-40"
        aria-label="Save"
      >
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-4 w-4" />}
      </button>
      <button onClick={onCancel} className="text-muted-foreground" aria-label="Cancel">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
