"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarDays,
  Check,
  CloudRain,
  Eye,
  EyeOff,
  HardHat,
  Loader2,
  Plus,
  StickyNote,
  Truck,
  X,
} from "lucide-react";
import { getPhaseFormOptions, updateSchedulePhase } from "@/lib/actions/schedule";
import type { BoardBar } from "@/lib/board/board-data";

/**
 * The phase panel — what opens when you click a bar.
 *
 * Answers the two questions the board couldn't: what is this, and who is on
 * it. Assignment writes straight through `updateSchedulePhase`, which already
 * emails newly-added people when the phase is confirmed, so scheduling
 * someone from the board notifies them exactly like scheduling them from the
 * project page does.
 */

interface Option {
  id: string;
  label: string;
  sub: string | null;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function BoardPhasePanel({
  bar,
  onClose,
  onAssigned,
}: {
  bar: BoardBar | null;
  onClose: () => void;
  onAssigned: (barId: string, employeeIds: string[], subIds: string[]) => void;
}) {
  const [employees, setEmployees] = useState<Option[]>([]);
  const [subs, setSubs] = useState<Option[]>([]);
  const [loadedOptions, setLoadedOptions] = useState(false);
  // Scoped to a bar id so switching phases closes the picker without an
  // effect — and without dropping the cached roster.
  const [pickingFor, setPickingFor] = useState<{ barId: string; kind: "crew" | "sub" } | null>(
    null,
  );
  const [saving, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bar || loadedOptions) return;
    let cancelled = false;
    getPhaseFormOptions()
      .then((opts) => {
        if (cancelled) return;
        setEmployees(
          (
            opts.employees as {
              id: string;
              first_name: string | null;
              last_name: string | null;
              title: string | null;
            }[]
          ).map((e) => ({
            id: e.id,
            label: [e.first_name, e.last_name].filter(Boolean).join(" ").trim() || "Unnamed",
            sub: e.title,
          })),
        );
        setSubs(
          (
            opts.subcontractors as {
              id: string;
              company_name: string | null;
              trades: string[] | null;
            }[]
          ).map((s) => ({
            id: s.id,
            label: s.company_name ?? "Unnamed",
            sub: s.trades?.join(", ") ?? null,
          })),
        );
        setLoadedOptions(true);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load the roster.");
      });
    return () => {
      cancelled = true;
    };
  }, [bar, loadedOptions]);

  if (!bar) return null;

  const picking = pickingFor?.barId === bar.id ? pickingFor.kind : null;
  const togglePicker = (kind: "crew" | "sub") =>
    setPickingFor(picking === kind ? null : { barId: bar.id, kind });

  const save = (employeeIds: string[], subIds: string[]) => {
    setError(null);
    onAssigned(bar.id, employeeIds, subIds);
    startSaving(async () => {
      const res = await updateSchedulePhase(bar.id, {
        project_id: bar.projectId,
        assigned_employee_ids: employeeIds,
        assigned_sub_ids: subIds,
      });
      if (res.error) setError(res.error);
    });
  };

  const toggleEmployee = (id: string) => {
    const next = bar.assignedEmployeeIds.includes(id)
      ? bar.assignedEmployeeIds.filter((x) => x !== id)
      : [...bar.assignedEmployeeIds, id];
    save(next, bar.assignedSubIds);
  };

  const toggleSub = (id: string) => {
    const next = bar.assignedSubIds.includes(id)
      ? bar.assignedSubIds.filter((x) => x !== id)
      : [...bar.assignedSubIds, id];
    save(bar.assignedEmployeeIds, next);
  };

  const nameOf = (list: Option[], id: string) => list.find((o) => o.id === id)?.label ?? "…";

  const days = spanDays(bar.startDate, bar.endDate);
  const onPortal = bar.phaseScope === "master";

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg"
      >
        {/* ── Header ── */}
        <SheetHeader className="space-y-0 border-b border-border px-6 pt-6 pb-5">
          <div className="flex items-start gap-3 pr-8">
            <span
              className="mt-1.5 h-4 w-4 shrink-0 rounded"
              style={{ backgroundColor: bar.color }}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-xl leading-snug">{bar.name}</SheetTitle>
              <SheetDescription className="pt-1 text-sm">{bar.projectName}</SheetDescription>
            </div>
          </div>

          <div className="flex items-center gap-2.5 pt-4">
            <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="text-base font-medium">
              {fmtLong(bar.startDate)}
              {bar.startDate !== bar.endDate && ` → ${fmtLong(bar.endDate)}`}
            </span>
            <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {days} day{days === 1 ? "" : "s"}
            </span>
          </div>

          <div className="flex flex-wrap gap-2 pt-3">
            <Pill
              tone={bar.isConfirmed ? "green" : "amber"}
              label={bar.isConfirmed ? "Confirmed" : "Tentative"}
            />
            <Pill tone="muted" label={bar.status.replace(/_/g, " ")} />
            {bar.isExterior && <Pill tone="sky" label="Exterior work" />}
            {!!bar.slipDays && bar.slipDays > 0 && (
              <Pill tone="red" label={`${bar.slipDays} days off plan`} />
            )}
          </div>
        </SheetHeader>

        <div className="flex flex-col gap-7 px-6 py-6">
          {!bar.isConfirmed && (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-sm leading-relaxed text-amber-200/90">
              Tentative — nobody has been emailed about this yet. Confirm it on the project page
              when the week is settled.
            </p>
          )}

          {bar.risks.length > 0 && (
            <section className="rounded-md border border-sky-500/30 bg-sky-500/10 px-3.5 py-3">
              <h3 className="flex items-center gap-2 text-sm font-medium text-sky-300">
                <CloudRain className="h-4 w-4" aria-hidden />
                Weather against this phase
              </h3>
              <ul className="pt-1.5">
                {bar.risks.slice(0, 5).map((r) => (
                  <li key={r.date} className="text-sm leading-relaxed text-muted-foreground">
                    {fmtLong(r.date)} — {r.reason}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {bar.description && (
            <Section icon={HardHat} title="Scope of work">
              <p className="text-sm leading-relaxed text-muted-foreground">{bar.description}</p>
            </Section>
          )}

          {bar.notes && (
            <Section icon={StickyNote} title="Notes">
              <p className="whitespace-pre-wrap rounded-md border border-border bg-muted/40 px-3.5 py-2.5 text-sm leading-relaxed text-muted-foreground">
                {bar.notes}
              </p>
            </Section>
          )}

          {/* ── Crew ── */}
          <Section
            icon={HardHat}
            title="Crew"
            aside={saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
          >
            <div className="flex flex-wrap gap-2">
              {bar.assignedEmployeeIds.map((id) => {
                const name = nameOf(employees, id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => toggleEmployee(id)}
                    title="Remove from this phase"
                    className="group flex items-center gap-2 rounded-full border border-green-500/30 bg-green-500/10 py-1 pl-1 pr-3 text-sm text-green-200 hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-green-500/20 text-xs font-medium">
                      {initials(name)}
                    </span>
                    {name}
                    <X className="h-3.5 w-3.5 opacity-40 group-hover:opacity-100" aria-hidden />
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => togglePicker("crew")}
                className="flex items-center gap-1.5 rounded-full border border-dashed border-border px-3.5 py-2 text-sm text-muted-foreground hover:border-primary hover:text-primary"
              >
                <Plus className="h-4 w-4" aria-hidden />
                Schedule someone
              </button>
            </div>
            {bar.assignedEmployeeIds.length === 0 && !picking && (
              <p className="text-sm text-muted-foreground">Nobody on this phase yet.</p>
            )}
            {picking === "crew" && (
              <Picker
                options={employees}
                selected={bar.assignedEmployeeIds}
                onToggle={toggleEmployee}
                empty="No active employees."
              />
            )}
          </Section>

          {/* ── Subs ── */}
          <Section icon={Truck} title="Subs">
            <div className="flex flex-wrap gap-2">
              {bar.assignedSubIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleSub(id)}
                  title="Remove from this phase"
                  className="group flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-3.5 py-2 text-sm text-blue-200 hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300"
                >
                  {nameOf(subs, id)}
                  <X className="h-3.5 w-3.5 opacity-40 group-hover:opacity-100" aria-hidden />
                </button>
              ))}
              <button
                type="button"
                onClick={() => togglePicker("sub")}
                className="flex items-center gap-1.5 rounded-full border border-dashed border-border px-3.5 py-2 text-sm text-muted-foreground hover:border-primary hover:text-primary"
              >
                <Plus className="h-4 w-4" aria-hidden />
                Add a sub
              </button>
            </div>
            {bar.assignedSubIds.length === 0 && !picking && (
              <p className="text-sm text-muted-foreground">No sub on this phase.</p>
            )}
            {picking === "sub" && (
              <Picker
                options={subs}
                selected={bar.assignedSubIds}
                onToggle={toggleSub}
                empty="No active subs."
              />
            )}
          </Section>

          {error && (
            <p className="flex items-start gap-2 text-sm text-red-400">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {error}
            </p>
          )}

          <div className="flex flex-col gap-3 border-t border-border pt-5">
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              {onPortal ? (
                <>
                  <Eye className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  On the master schedule — the client sees this in their portal.
                </>
              ) : (
                <>
                  <EyeOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  Daily schedule only — internal, not shown to the client.
                </>
              )}
            </p>
            <Button asChild variant="outline" className="w-full">
              <Link href={`/projects/${bar.projectId}`}>
                Open project
                <ArrowUpRight className="ml-1.5 h-4 w-4" aria-hidden />
              </Link>
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Section({
  icon: Icon,
  title,
  aside,
  children,
}: {
  icon: typeof HardHat;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {title}
        {aside}
      </h3>
      {children}
    </section>
  );
}

function Pill({
  tone,
  label,
}: {
  tone: "green" | "amber" | "red" | "sky" | "muted";
  label: string;
}) {
  const tones = {
    green: "bg-green-500/15 text-green-400",
    amber: "bg-amber-500/15 text-amber-400",
    red: "bg-red-500/15 text-red-400",
    sky: "bg-sky-500/15 text-sky-400",
    muted: "bg-muted text-muted-foreground",
  } as const;
  return (
    <span className={`rounded-full px-3 py-1 text-xs capitalize ${tones[tone]}`}>{label}</span>
  );
}

function Picker({
  options,
  selected,
  onToggle,
  empty,
}: {
  options: Option[];
  selected: string[];
  onToggle: (id: string) => void;
  empty: string;
}) {
  const [q, setQ] = useState("");
  const filtered = q ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : options;

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-muted/20 p-2.5">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search"
        autoFocus
        className="w-full rounded-md bg-background px-3 py-2 text-sm outline-none ring-1 ring-border focus:ring-primary"
      />
      <div className="max-h-64 overflow-y-auto pt-1">
        {filtered.map((o) => {
          const on = selected.includes(o.id);
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onToggle(o.id)}
              className="flex w-full items-center gap-3 rounded-md px-2.5 py-2.5 text-left text-sm hover:bg-muted"
            >
              <span
                className={`flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded border ${
                  on ? "border-primary bg-primary text-primary-foreground" : "border-border"
                }`}
                style={{ width: 18, height: 18 }}
                aria-hidden
              >
                {on && <Check className="h-3 w-3" />}
              </span>
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {o.sub && (
                <span className="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">
                  {o.sub}
                </span>
              )}
            </button>
          );
        })}
        {filtered.length === 0 && <p className="px-2.5 py-3 text-sm text-muted-foreground">{empty}</p>}
      </div>
    </div>
  );
}

function fmtLong(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function spanDays(a: string, b: string) {
  const d1 = new Date(`${a}T00:00:00`).getTime();
  const d2 = new Date(`${b}T00:00:00`).getTime();
  return Math.round((d2 - d1) / 86400000) + 1;
}
