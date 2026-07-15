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
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  getPayrollTimesheet,
  setPayrollBreak,
  updateTimeEntry,
  type PayrollTimesheet,
  type PayrollEntry,
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

function fmtDayLabel(dateStr: string): string {
  // Anchor at noon so timezone never shifts the calendar date.
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
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
        <Card className="p-3 text-center">
          <Users className="h-4 w-4 mx-auto mb-1 text-green-500" />
          <p className="text-2xl font-bold">{sheet?.totals.workerCount ?? 0}</p>
          <p className="text-[10px] text-muted-foreground">Workers with hours</p>
        </Card>
        <Card className="p-3 text-center">
          <Clock className="h-4 w-4 mx-auto mb-1 text-amber-500" />
          <p className="text-2xl font-bold text-amber-500">
            {sheet ? fmtHM(sheet.totals.paidMinutes) : "0h 0m"}
          </p>
          <p className="text-[10px] text-muted-foreground">Paid hours</p>
        </Card>
        <Card className="p-3 text-center">
          <DollarSign className="h-4 w-4 mx-auto mb-1 text-red-400" />
          <p className="text-2xl font-bold text-red-400">
            {sheet ? fmtMoney(sheet.totals.costCents) : "$0"}
          </p>
          <p className="text-[10px] text-muted-foreground">Labor cost</p>
        </Card>
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
          <Card key={w.profileId} className="p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <p className="font-semibold">{w.name}</p>
                <p className="text-xs text-muted-foreground">
                  {w.hourlyRate != null ? `$${w.hourlyRate}/hr` : "No rate set"}
                </p>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold text-amber-500">{fmtHM(w.totalPaidMinutes)}</p>
                <p className="text-[11px] text-muted-foreground">
                  {fmtDec(w.totalPaidMinutes)} hrs
                  {w.hourlyRate != null && ` · ${fmtMoney(w.costCents)}`}
                </p>
              </div>
            </div>

            <div className="divide-y divide-border/60">
              {w.days.map((day) => (
                <DayRow
                  key={day.date}
                  profileId={w.profileId}
                  date={day.date}
                  entries={day.entries}
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
    <div className="py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium w-24 shrink-0">{fmtDayLabel(date)}</span>

        <div className="flex-1 min-w-0 space-y-1">
          {entries.map((e) =>
            editEntryId === e.id ? (
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
              <div key={e.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={e.clockOut ? "" : "text-green-500"}>
                  {fmtClock(e.clockIn)} {e.clockOut ? `– ${fmtClock(e.clockOut)}` : "– (still in)"}
                </span>
                {e.autoClockedOut && (
                  <span className="text-[9px] uppercase font-semibold text-amber-500/80">auto</span>
                )}
                {e.edited && (
                  <span className="text-[9px] uppercase font-semibold text-blue-400/80">edited</span>
                )}
                <button
                  onClick={() => setEditEntryId(e.id)}
                  className="opacity-50 hover:opacity-100"
                  aria-label="Edit times"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              </div>
            ),
          )}
        </div>

        {/* Break */}
        <div className="w-20 shrink-0 text-right">
          {editingBreak ? (
            <div className="flex items-center justify-end gap-1">
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
        </div>

        {/* Paid */}
        <div className="w-16 shrink-0 text-right">
          <p className="text-sm font-semibold">{fmtHM(paidMinutes)}</p>
          {rawMinutes !== paidMinutes && (
            <p className="text-[10px] text-muted-foreground line-through">{fmtHM(rawMinutes)}</p>
          )}
          {hasOpen && <p className="text-[9px] text-green-500 uppercase font-semibold">on clock</p>}
        </div>
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
