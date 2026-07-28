"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Check, Loader2, Plus, Trash2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveVto } from "@/lib/actions/eos-vto";
import type { EosCoreValue, EosVto } from "@/types/eos";

/**
 * The Vision/Traction Organizer. Mostly empty until Vision Building Day 1
 * (2026-08-13) — that session is what fills it in. Each card saves on its
 * own so the team can work down the page in the room.
 */
export function VtoEditor({
  vto,
  quarter,
  openIssues,
}: {
  vto: EosVto | null;
  quarter: string;
  openIssues: number;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Vision
        </h2>

        <ListCard
          title="Core Values"
          hint="Three to seven. Who we already are, not who we wish we were."
          items={(vto?.coreValues ?? []).map(
            (v) => `${v.title}${v.description ? ` — ${v.description}` : ""}`,
          )}
          placeholder="e.g. Do it right the first time"
          onSave={(lines) =>
            saveVto({
              coreValues: lines.map<EosCoreValue>((line) => {
                const [title, ...rest] = line.split(" — ");
                return { title: title.trim(), description: rest.join(" — ").trim() };
              }),
            })
          }
        />

        <TextCard
          title="Core Focus"
          fields={[
            {
              key: "purpose",
              label: "Purpose / cause / passion",
              value: vto?.purpose ?? "",
              rows: 2,
            },
            { key: "niche", label: "Our niche", value: vto?.niche ?? "", rows: 2 },
          ]}
        />

        <TextCard
          title="10-Year Target"
          fields={[
            {
              key: "tenYearTarget",
              label: "Where the company is in ten years",
              value: vto?.tenYearTarget ?? "",
              rows: 2,
            },
          ]}
        />

        <TextCard
          title="Marketing Strategy"
          fields={[
            {
              key: "targetMarket",
              label: "Target market — the list",
              value: vto?.targetMarket ?? "",
              rows: 2,
            },
            {
              key: "provenProcess",
              label: "Proven process",
              value: vto?.provenProcess ?? "",
              rows: 3,
            },
            {
              key: "guarantee",
              label: "Guarantee",
              value: vto?.guarantee ?? "",
              rows: 2,
            },
          ]}
        />

        <ListCard
          title="Three Uniques"
          hint="What genuinely separates Penney from the next GC."
          items={vto?.threeUniques ?? []}
          placeholder="e.g. Fixed-price contracts with no surprise change orders"
          onSave={(lines) => saveVto({ threeUniques: lines })}
        />
      </div>

      <div className="space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Traction
        </h2>

        <PictureCard
          title="3-Year Picture"
          date={vto?.threeYearDate ?? ""}
          revenue={vto?.threeYearRevenue ?? null}
          profit={vto?.threeYearProfit ?? null}
          measurables={vto?.threeYearMeasurables ?? ""}
          bullets={vto?.threeYearPicture ?? []}
          bulletLabel="What does it look like?"
          keys={{
            date: "threeYearDate",
            revenue: "threeYearRevenue",
            profit: "threeYearProfit",
            measurables: "threeYearMeasurables",
            bullets: "threeYearPicture",
          }}
        />

        <PictureCard
          title="1-Year Plan"
          date={vto?.oneYearDate ?? ""}
          revenue={vto?.oneYearRevenue ?? null}
          profit={vto?.oneYearProfit ?? null}
          measurables={vto?.oneYearMeasurables ?? ""}
          bullets={vto?.oneYearGoals ?? []}
          bulletLabel="Goals for the year"
          keys={{
            date: "oneYearDate",
            revenue: "oneYearRevenue",
            profit: "oneYearProfit",
            measurables: "oneYearMeasurables",
            bullets: "oneYearGoals",
          }}
        />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Rocks — {quarter}</CardTitle>
          </CardHeader>
          <CardContent>
            <Link
              href="/eos/rocks"
              className="flex items-center gap-1.5 text-sm font-medium text-amber-500 hover:underline"
            >
              Manage this quarter&apos;s Rocks
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Issues List</CardTitle>
          </CardHeader>
          <CardContent>
            <Link
              href="/eos/issues"
              className="flex items-center gap-1.5 text-sm font-medium text-amber-500 hover:underline"
            >
              {openIssues} open {openIssues === 1 ? "issue" : "issues"}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

type SaveState = "idle" | "saving" | "saved" | "error";

function useSaver() {
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setState("saving");
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error ?? "Could not save.");
        setState("error");
        return;
      }
      setState("saved");
    });
  }

  return { state, error, pending, run };
}

function SaveButton({
  state,
  pending,
  onClick,
}: {
  state: SaveState;
  pending: boolean;
  onClick: () => void;
}) {
  return (
    <Button size="sm" variant="secondary" onClick={onClick} disabled={pending}>
      {pending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
      {state === "saved" && !pending && (
        <Check className="mr-2 h-3.5 w-3.5 text-emerald-500" />
      )}
      Save
    </Button>
  );
}

function TextCard({
  title,
  fields,
}: {
  title: string;
  fields: { key: string; label: string; value: string; rows: number }[];
}) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.key, f.value])),
  );
  const { state, error, pending, run } = useSaver();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {fields.map((field) => (
          <div key={field.key} className="space-y-1.5">
            <Label htmlFor={`vto-${field.key}`} className="text-xs">
              {field.label}
            </Label>
            <Textarea
              id={`vto-${field.key}`}
              value={values[field.key] ?? ""}
              onChange={(e) =>
                setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
              }
              rows={field.rows}
            />
          </div>
        ))}
        {error && <p className="text-sm text-red-500">{error}</p>}
        <SaveButton
          state={state}
          pending={pending}
          onClick={() => run(() => saveVto(values))}
        />
      </CardContent>
    </Card>
  );
}

function ListCard({
  title,
  hint,
  items,
  placeholder,
  onSave,
}: {
  title: string;
  hint?: string;
  items: string[];
  placeholder: string;
  onSave: (lines: string[]) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [lines, setLines] = useState<string[]>(items);
  const [draft, setDraft] = useState("");
  const { state, error, pending, run } = useSaver();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardHeader>
      <CardContent className="space-y-2">
        {lines.length === 0 && (
          <p className="text-sm text-muted-foreground">Nothing here yet.</p>
        )}
        {lines.map((line, index) => (
          <div key={index} className="flex items-start gap-2">
            <Input
              value={line}
              onChange={(e) =>
                setLines((prev) =>
                  prev.map((l, i) => (i === index ? e.target.value : l)),
                )
              }
              className="text-sm"
            />
            <Button
              size="icon"
              variant="ghost"
              className="h-9 w-9 shrink-0 text-red-500 hover:text-red-500"
              onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span className="sr-only">Remove</span>
            </Button>
          </div>
        ))}

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const value = draft.trim();
            if (!value) return;
            setLines((prev) => [...prev, value]);
            setDraft("");
          }}
        >
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            className="text-sm"
          />
          <Button type="submit" size="icon" variant="secondary" className="h-9 w-9 shrink-0">
            <Plus className="h-4 w-4" />
            <span className="sr-only">Add</span>
          </Button>
        </form>

        {error && <p className="text-sm text-red-500">{error}</p>}
        <SaveButton
          state={state}
          pending={pending}
          onClick={() => run(() => onSave(lines.map((l) => l.trim()).filter(Boolean)))}
        />
      </CardContent>
    </Card>
  );
}

function PictureCard({
  title,
  date,
  revenue,
  profit,
  measurables,
  bullets,
  bulletLabel,
  keys,
}: {
  title: string;
  date: string;
  revenue: number | null;
  profit: number | null;
  measurables: string;
  bullets: string[];
  bulletLabel: string;
  keys: {
    date: string;
    revenue: string;
    profit: string;
    measurables: string;
    bullets: string;
  };
}) {
  const [dateValue, setDateValue] = useState(date);
  const [revenueValue, setRevenueValue] = useState(
    revenue === null ? "" : String(revenue),
  );
  const [profitValue, setProfitValue] = useState(
    profit === null ? "" : String(profit),
  );
  const [measurablesValue, setMeasurablesValue] = useState(measurables);
  const [lines, setLines] = useState<string[]>(bullets);
  const [draft, setDraft] = useState("");
  const { state, error, pending, run } = useSaver();

  function numberOrNull(raw: string): number | null | undefined {
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed.replace(/[$,]/g, ""));
    return Number.isFinite(n) ? n : undefined;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${keys.date}-input`} className="text-xs">
              Future date
            </Label>
            <Input
              id={`${keys.date}-input`}
              type="date"
              value={dateValue}
              onChange={(e) => setDateValue(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${keys.revenue}-input`} className="text-xs">
              Revenue
            </Label>
            <Input
              id={`${keys.revenue}-input`}
              value={revenueValue}
              onChange={(e) => setRevenueValue(e.target.value)}
              inputMode="decimal"
              placeholder="$"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${keys.profit}-input`} className="text-xs">
              Profit
            </Label>
            <Input
              id={`${keys.profit}-input`}
              value={profitValue}
              onChange={(e) => setProfitValue(e.target.value)}
              inputMode="decimal"
              placeholder="$"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${keys.measurables}-input`} className="text-xs">
            Measurables
          </Label>
          <Input
            id={`${keys.measurables}-input`}
            value={measurablesValue}
            onChange={(e) => setMeasurablesValue(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">{bulletLabel}</Label>
          {lines.map((line, index) => (
            <div key={index} className="flex items-start gap-2">
              <Input
                value={line}
                onChange={(e) =>
                  setLines((prev) =>
                    prev.map((l, i) => (i === index ? e.target.value : l)),
                  )
                }
                className="text-sm"
              />
              <Button
                size="icon"
                variant="ghost"
                className="h-9 w-9 shrink-0 text-red-500 hover:text-red-500"
                onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span className="sr-only">Remove</span>
              </Button>
            </div>
          ))}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const value = draft.trim();
              if (!value) return;
              setLines((prev) => [...prev, value]);
              setDraft("");
            }}
          >
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Add a line…"
              className="text-sm"
            />
            <Button type="submit" size="icon" variant="secondary" className="h-9 w-9 shrink-0">
              <Plus className="h-4 w-4" />
              <span className="sr-only">Add</span>
            </Button>
          </form>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}
        <SaveButton
          state={state}
          pending={pending}
          onClick={() => {
            const rev = numberOrNull(revenueValue);
            const prof = numberOrNull(profitValue);
            if (rev === undefined || prof === undefined) {
              run(async () => ({
                ok: false,
                error: "Revenue and profit must be numbers, or blank.",
              }));
              return;
            }
            run(() =>
              saveVto({
                [keys.date]: dateValue || null,
                [keys.revenue]: rev,
                [keys.profit]: prof,
                [keys.measurables]: measurablesValue,
                [keys.bullets]: lines.map((l) => l.trim()).filter(Boolean),
              }),
            );
          }}
        />
      </CardContent>
    </Card>
  );
}
