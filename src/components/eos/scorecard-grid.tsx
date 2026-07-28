"use client";

import { useState, useTransition } from "react";
import { Plus, Pencil, Archive, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  UNIT_LABELS,
  formatMeasurable,
  formatWeekLabel,
  isOnGoal,
} from "@/lib/constants/eos";
import {
  archiveMeasurable,
  createMeasurable,
  updateMeasurable,
  upsertScore,
} from "@/lib/actions/eos-scorecard";
import type { EosMeasurable, EosPerson, EosUnit } from "@/types/eos";
import { cn } from "@/lib/utils";

const UNITS = Object.keys(UNIT_LABELS) as EosUnit[];
const COMPARISONS = [">=", "<=", "=", ">", "<"] as const;
const UNASSIGNED = "unassigned";

export function ScorecardGrid({
  measurables,
  weeks,
  people,
}: {
  measurables: EosMeasurable[];
  weeks: string[];
  people: EosPerson[];
}) {
  const [editing, setEditing] = useState<EosMeasurable | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Read the numbers at the L10 — anything off goal becomes an issue,
          it does not get discussed in the Scorecard segment.
        </p>
        <Button onClick={() => setCreating(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Add measurable
        </Button>
      </div>

      {measurables.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No measurables yet. A scorecard is 5-15 numbers, one owner each.
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="sticky left-0 z-10 min-w-[200px] bg-muted/40 px-3 py-2 text-left font-medium backdrop-blur">
                  Measurable
                </th>
                <th className="min-w-[80px] px-2 py-2 text-right font-medium">Goal</th>
                {weeks.map((week) => (
                  <th
                    key={week}
                    className="min-w-[72px] px-1 py-2 text-center text-xs font-medium tabular-nums"
                  >
                    {formatWeekLabel(week)}
                  </th>
                ))}
                <th className="w-16 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {measurables.map((m) => (
                <tr key={m.id} className="border-b last:border-0">
                  <td className="sticky left-0 z-10 bg-background px-3 py-1.5">
                    <p className="font-medium leading-tight">{m.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {m.ownerName ?? "Unassigned"}
                    </p>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right text-xs text-muted-foreground tabular-nums">
                    {m.goalTarget === null ? (
                      <span title="No goal agreed yet — set it at an L10">TBD</span>
                    ) : (
                      `${m.comparison} ${formatMeasurable(m.goalTarget, m.unit)}`
                    )}
                  </td>
                  {weeks.map((week) => (
                    <ScoreCell
                      key={week}
                      measurable={m}
                      week={week}
                      value={m.scores[week] ?? null}
                    />
                  ))}
                  <td className="px-2 py-1.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setEditing(m)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      <span className="sr-only">Edit {m.name}</span>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(creating || editing) && (
        <MeasurableDialog
          measurable={editing}
          people={people}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function ScoreCell({
  measurable,
  week,
  value,
}: {
  measurable: EosMeasurable;
  week: string;
  value: number | null;
}) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  const [pending, startTransition] = useTransition();

  const hit = isOnGoal(value, measurable.goalTarget, measurable.comparison);

  function commit() {
    const trimmed = draft.trim();
    const next = trimmed === "" ? null : Number(trimmed);

    if (next !== null && !Number.isFinite(next)) {
      setDraft(value === null ? "" : String(value));
      return;
    }
    if (next === value) return;

    startTransition(async () => {
      const result = await upsertScore({
        measurableId: measurable.id,
        weekEnding: week,
        value: next,
      });
      if (!result.ok) setDraft(value === null ? "" : String(value));
    });
  }

  return (
    <td className="p-0.5">
      <div className="relative">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setDraft(value === null ? "" : String(value));
              e.currentTarget.blur();
            }
          }}
          inputMode="decimal"
          aria-label={`${measurable.name}, week ending ${week}`}
          className={cn(
            "h-8 border-transparent bg-transparent px-1 text-center text-xs tabular-nums hover:border-border focus:border-amber-500",
            hit === true && "text-emerald-500",
            hit === false && "text-red-500 font-medium",
          )}
        />
        {pending && (
          <Loader2 className="pointer-events-none absolute right-0.5 top-1/2 h-3 w-3 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>
    </td>
  );
}

function MeasurableDialog({
  measurable,
  people,
  onClose,
}: {
  measurable: EosMeasurable | null;
  people: EosPerson[];
  onClose: () => void;
}) {
  const [name, setName] = useState(measurable?.name ?? "");
  const [description, setDescription] = useState(measurable?.description ?? "");
  const [ownerId, setOwnerId] = useState(measurable?.ownerId ?? UNASSIGNED);
  const [unit, setUnit] = useState<EosUnit>(measurable?.unit ?? "number");
  const [goal, setGoal] = useState(
    measurable?.goalTarget === null || measurable?.goalTarget === undefined
      ? ""
      : String(measurable.goalTarget),
  );
  const [comparison, setComparison] = useState(measurable?.comparison ?? ">=");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    const trimmedGoal = goal.trim();
    const goalTarget = trimmedGoal === "" ? null : Number(trimmedGoal);

    if (goalTarget !== null && !Number.isFinite(goalTarget)) {
      setError("Goal must be a number, or blank if it is still TBD.");
      return;
    }

    const payload = {
      name,
      description: description || null,
      ownerProfileId: ownerId === UNASSIGNED ? null : ownerId,
      unit,
      goalTarget,
      comparison: comparison as (typeof COMPARISONS)[number],
      cadence: measurable?.cadence ?? ("weekly" as const),
    };

    startTransition(async () => {
      const result = measurable
        ? await updateMeasurable({ ...payload, id: measurable.id })
        : await createMeasurable(payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {measurable ? "Edit measurable" : "Add measurable"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="m-name">Name</Label>
            <Input
              id="m-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Weekly Sales Revenue"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="m-owner">Owner</Label>
              <Select value={ownerId} onValueChange={setOwnerId}>
                <SelectTrigger id="m-owner">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                  {people.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="m-unit">Unit</Label>
              <Select value={unit} onValueChange={(v) => setUnit(v as EosUnit)}>
                <SelectTrigger id="m-unit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UNITS.map((u) => (
                    <SelectItem key={u} value={u}>
                      {UNIT_LABELS[u]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="m-comparison">Goal is</Label>
              <Select value={comparison} onValueChange={setComparison}>
                <SelectTrigger id="m-comparison">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMPARISONS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="m-goal">Goal</Label>
              <Input
                id="m-goal"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                inputMode="decimal"
                placeholder="Leave blank if TBD"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="m-desc">Notes</Label>
            <Textarea
              id="m-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="How the number is measured, where it comes from…"
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {measurable ? (
            <Button
              variant="ghost"
              onClick={() =>
                startTransition(async () => {
                  await archiveMeasurable(measurable.id);
                  onClose();
                })
              }
            >
              <Archive className="mr-2 h-4 w-4" />
              Archive
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {measurable ? "Save" : "Add"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
