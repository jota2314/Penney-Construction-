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
  Check,
  CloudRain,
  HardHat,
  Loader2,
  Plus,
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

  // Roster is only needed once a panel is actually opened.
  useEffect(() => {
    if (!bar || loadedOptions) return;
    let cancelled = false;
    getPhaseFormOptions()
      .then((opts) => {
        if (cancelled) return;
        setEmployees(
          (opts.employees as { id: string; first_name: string | null; last_name: string | null; title: string | null }[]).map(
            (e) => ({
              id: e.id,
              label: [e.first_name, e.last_name].filter(Boolean).join(" ").trim() || "Unnamed",
              sub: e.title,
            }),
          ),
        );
        setSubs(
          (opts.subcontractors as { id: string; company_name: string | null; trades: string[] | null }[]).map(
            (s) => ({
              id: s.id,
              label: s.company_name ?? "Unnamed",
              sub: s.trades?.join(", ") ?? null,
            }),
          ),
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
    // Paint it immediately; the server action re-syncs on refresh.
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

  const nameOf = (list: Option[], id: string) =>
    list.find((o) => o.id === id)?.label ?? "…";

  const span =
    bar.startDate === bar.endDate
      ? fmt(bar.startDate)
      : `${fmt(bar.startDate)} – ${fmt(bar.endDate)}`;

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-sm">
        <SheetHeader className="space-y-1">
          <div className="flex items-start gap-2 pr-6">
            <span
              className="mt-1.5 h-3 w-3 shrink-0 rounded-sm"
              style={{ backgroundColor: bar.color }}
              aria-hidden
            />
            <SheetTitle className="text-base leading-tight">{bar.name}</SheetTitle>
          </div>
          <SheetDescription className="text-xs">
            {bar.projectName} · {span}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 px-4 py-4">
          <div className="flex flex-wrap gap-1.5">
            <span
              className={`rounded px-2 py-0.5 text-[11px] ${
                bar.isConfirmed
                  ? "bg-green-500/15 text-green-400"
                  : "bg-amber-500/15 text-amber-500"
              }`}
            >
              {bar.isConfirmed ? "Confirmed" : "Tentative"}
            </span>
            <span className="rounded bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              {bar.status}
            </span>
            {bar.isExterior && (
              <span className="rounded bg-sky-500/15 px-2 py-0.5 text-[11px] text-sky-400">
                Exterior
              </span>
            )}
            {!!bar.slipDays && bar.slipDays > 0 && (
              <span className="rounded bg-red-500/15 px-2 py-0.5 text-[11px] text-red-400">
                {bar.slipDays}d off plan
              </span>
            )}
          </div>

          {bar.risks.length > 0 && (
            <div className="rounded-md border border-sky-500/30 bg-sky-500/10 p-2.5">
              <p className="flex items-center gap-1.5 text-xs text-sky-400">
                <CloudRain className="h-3.5 w-3.5" aria-hidden />
                Weather against this phase
              </p>
              {bar.risks.slice(0, 4).map((r) => (
                <p key={r.date} className="pt-0.5 text-[11px] text-muted-foreground">
                  {fmt(r.date)} — {r.reason}
                </p>
              ))}
            </div>
          )}

          {bar.scope && (
            <section className="flex flex-col gap-1">
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Scope
              </h3>
              <p className="text-xs leading-relaxed text-muted-foreground">{bar.scope}</p>
            </section>
          )}

          {/* ── Who's responsible ── */}
          <section className="flex flex-col gap-2">
            <h3 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <HardHat className="h-3 w-3" aria-hidden />
              Crew
              {saving && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
            </h3>

            <div className="flex flex-wrap gap-1.5">
              {bar.assignedEmployeeIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleEmployee(id)}
                  className="group inline-flex items-center gap-1 rounded bg-green-500/15 px-2 py-1 text-xs text-green-300 hover:bg-red-500/15 hover:text-red-400"
                  title="Remove from this phase"
                >
                  {nameOf(employees, id)}
                  <X className="h-3 w-3 opacity-50 group-hover:opacity-100" aria-hidden />
                </button>
              ))}
              {bar.assignedEmployeeIds.length === 0 && (
                <span className="text-xs text-muted-foreground">Nobody assigned.</span>
              )}
              <button
                type="button"
                onClick={() => togglePicker("crew")}
                className="inline-flex items-center gap-1 rounded border border-dashed border-border px-2 py-1 text-xs text-muted-foreground hover:border-primary hover:text-primary"
              >
                <Plus className="h-3 w-3" aria-hidden />
                Schedule someone
              </button>
            </div>

            {picking === "crew" && (
              <Picker
                options={employees}
                selected={bar.assignedEmployeeIds}
                onToggle={toggleEmployee}
                empty="No active employees."
              />
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <Truck className="h-3 w-3" aria-hidden />
              Subs
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {bar.assignedSubIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleSub(id)}
                  className="group inline-flex items-center gap-1 rounded bg-blue-500/15 px-2 py-1 text-xs text-blue-300 hover:bg-red-500/15 hover:text-red-400"
                  title="Remove from this phase"
                >
                  {nameOf(subs, id)}
                  <X className="h-3 w-3 opacity-50 group-hover:opacity-100" aria-hidden />
                </button>
              ))}
              {bar.assignedSubIds.length === 0 && (
                <span className="text-xs text-muted-foreground">No sub on this phase.</span>
              )}
              <button
                type="button"
                onClick={() => togglePicker("sub")}
                className="inline-flex items-center gap-1 rounded border border-dashed border-border px-2 py-1 text-xs text-muted-foreground hover:border-primary hover:text-primary"
              >
                <Plus className="h-3 w-3" aria-hidden />
                Add a sub
              </button>
            </div>

            {picking === "sub" && (
              <Picker
                options={subs}
                selected={bar.assignedSubIds}
                onToggle={toggleSub}
                empty="No active subs."
              />
            )}
          </section>

          {bar.isConfirmed && (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              This phase is confirmed, so anyone you add here gets the
              &ldquo;you&rsquo;re scheduled&rdquo; email.
            </p>
          )}

          {error && (
            <p className="flex items-start gap-1.5 text-xs text-red-400">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              {error}
            </p>
          )}

          <Button asChild size="sm" variant="outline" className="w-full">
            <Link href={`/projects/${bar.projectId}`}>
              Open project
              <ArrowUpRight className="ml-1 h-3.5 w-3.5" aria-hidden />
            </Link>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
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
  const filtered = q
    ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()))
    : options;

  return (
    <div className="flex flex-col gap-1 rounded-md border border-border p-2">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search"
        className="w-full rounded bg-muted px-2 py-1 text-xs outline-none placeholder:text-muted-foreground"
      />
      <div className="max-h-52 overflow-y-auto">
        {filtered.map((o) => {
          const on = selected.includes(o.id);
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onToggle(o.id)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
            >
              <span
                className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border ${
                  on ? "border-primary bg-primary text-primary-foreground" : "border-border"
                }`}
                aria-hidden
              >
                {on && <Check className="h-2.5 w-2.5" />}
              </span>
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {o.sub && (
                <span className="shrink-0 truncate text-[10px] text-muted-foreground">
                  {o.sub}
                </span>
              )}
            </button>
          );
        })}
        {filtered.length === 0 && (
          <p className="px-2 py-2 text-xs text-muted-foreground">{empty}</p>
        )}
      </div>
    </div>
  );
}

function fmt(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
