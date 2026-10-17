"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Loader2, RefreshCw, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  assignSubsToPhases,
  confirmAndNotify,
  getSubsNeeded,
  getSubsNeededSummary,
  putSubOnToday,
  saveSubAlias,
  type SubsNeededData,
  type SubsNeededNobodyRow,
  type SubsNeededPenciledRow,
  type SubsNeededSummary,
  type SubsNeededUnscheduledRow,
} from "@/lib/actions/sub-assign";

/**
 * Subs needed — the work that has nobody on it, the subs penciled in who
 * still need the confirm-and-email, and the subs who showed up today where
 * the schedule doesn't have them.
 *
 * Worked out when it opens, from the schedule as it is, so it also catches
 * phases the AI email engine or a SQL rebuild wrote without anyone on them.
 * Every save is a tap here: nothing assigns itself, and the line above each
 * button says who (if anyone) will be emailed before it's pressed.
 */

const SUMMARY_REFRESH_MS = 5 * 60_000;

const noopSubscribe = () => () => {};

// ── Chip for the board header ───────────────────────────────────

function chipLabel(s: SubsNeededSummary): string {
  if (s.jobsWithNobody > 0) {
    return `${s.jobsWithNobody} upcoming job${s.jobsWithNobody === 1 ? " has" : "s have"} nobody`;
  }
  return `Subs needed · ${s.total}`;
}

function chipTitle(s: SubsNeededSummary): string {
  const parts = [
    `${s.nobody} phase${s.nobody === 1 ? "" : "s"} in the next 14 days with nobody on ${s.nobody === 1 ? "it" : "them"}`,
    `${s.penciled} penciled-in sub${s.penciled === 1 ? "" : "s"} starting within 7 days`,
    `${s.unscheduled} sub${s.unscheduled === 1 ? "" : "s"} on site today but not on the schedule`,
  ];
  return parts.join(" · ");
}

/** Self-fetching header chip; renders nothing when there's nothing to do. */
export function SubsNeededChip({ className }: { className?: string }) {
  const [summary, setSummary] = useState<SubsNeededSummary | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    getSubsNeededSummary()
      .then((s) => {
        if (!s.error || s.total > 0) setSummary(s);
      })
      .catch(() => {
        /* the chip is a nudge; a failed count just leaves it as it was */
      });
  }, []);

  useEffect(() => {
    load();
    const refresh = () => {
      if (document.visibilityState === "visible") load();
    };
    const timer = window.setInterval(refresh, SUMMARY_REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  const sheet = open ? (
    <SubsNeededSheet
      onClose={() => {
        setOpen(false);
        load();
      }}
    />
  ) : null;

  if (!summary || summary.total === 0) return sheet;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className={cn("h-8 border-amber-500/50 text-amber-500 hover:text-amber-400", className)}
        onClick={() => setOpen(true)}
        title={chipTitle(summary)}
      >
        <Users className="mr-1 h-3.5 w-3.5" aria-hidden />
        {chipLabel(summary)}
      </Button>
      {sheet}
    </>
  );
}

// ── The sheet ───────────────────────────────────────────────────

type TabKey = "nobody" | "penciled" | "unscheduled";

export function SubsNeededSheet({
  projectId,
  onClose,
}: {
  projectId?: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [data, setData] = useState<SubsNeededData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<TabKey | null>(null);
  // Portals need the document: false on the server and while hydrating.
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const pressStartedOnBackdrop = useRef(false);

  const fetchData = useCallback(
    () =>
      getSubsNeeded({ projectId: projectId ?? null })
        .then((d) => {
          setData(d);
          setFailed(false);
          setTab((prev) => prev ?? (d.nobody.length ? "nobody" : d.penciled.length ? "penciled" : d.unscheduled.length ? "unscheduled" : "nobody"));
        })
        .catch(() => setFailed(true))
        .finally(() => setLoading(false)),
    [projectId],
  );

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const load = () => {
    setLoading(true);
    void fetchData();
  };

  // Esc closes; the page behind doesn't scroll while it's open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  /** A save landed: the board behind should show it too. */
  const changed = useCallback(() => router.refresh(), [router]);

  if (!mounted) return null;

  const counts = {
    nobody: data?.nobody.length ?? 0,
    penciled: data?.penciled.length ?? 0,
    unscheduled: data?.unscheduled.length ?? 0,
  };
  const active: TabKey = tab ?? "nobody";

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex justify-end bg-black/60"
      onPointerDown={(e) => {
        pressStartedOnBackdrop.current = e.target === e.currentTarget;
      }}
      onPointerUp={(e) => {
        if (pressStartedOnBackdrop.current && e.target === e.currentTarget) onClose();
        pressStartedOnBackdrop.current = false;
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Subs needed"
        className="flex h-full w-full min-w-0 flex-col border-l border-border bg-background shadow-xl sm:max-w-2xl"
      >
        <header className="flex items-start gap-3 border-b border-border px-5 pt-5 pb-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold leading-snug">Subs needed</h2>
            <p className="pt-0.5 text-sm text-muted-foreground">
              {data?.projectName ?? "All open jobs"} · next 14 days
            </p>
          </div>
          <Button variant="outline" size="sm" className="h-11 px-3" onClick={load} disabled={loading} aria-label="Refresh">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
          </Button>
          <Button variant="outline" size="sm" className="h-11 px-4" onClick={onClose}>
            <X className="mr-1 h-4 w-4" aria-hidden />
            Close
          </Button>
        </header>

        <nav className="flex gap-2 overflow-x-auto border-b border-border px-5 py-3" aria-label="Lists">
          {(
            [
              ["nobody", "Nobody on it"],
              ["penciled", "Penciled in, starting within 7 days"],
              ["unscheduled", "Unscheduled sub today"],
            ] as [TabKey, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                "flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-4 text-sm",
                active === key ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-foreground">{counts[key]}</span>
            </button>
          ))}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {(failed || data?.error) && (
            <p className="mb-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {failed ? "Couldn't load. Check the connection and refresh." : data?.error}
            </p>
          )}
          {!data && loading && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Reading the schedule…
            </p>
          )}
          {data && active === "nobody" && <NobodyList data={data} onChanged={changed} onReload={load} />}
          {data && active === "penciled" && <PenciledList rows={data.penciled} onChanged={changed} />}
          {data && active === "unscheduled" && <UnscheduledList rows={data.unscheduled} onChanged={changed} />}
        </div>

        <footer className="border-t border-border px-5 py-3">
          <Button variant="outline" className="h-11 w-full" onClick={onClose}>
            Close
          </Button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

// ── Nobody on it ────────────────────────────────────────────────

/** Rank 1–4 suggestions are evidence about this job; 5–6 are only "does this trade". */
const STRONG_RANK = 4;

function NobodyList({ data, onChanged, onReload }: { data: SubsNeededData; onChanged: () => void; onReload: () => void }) {
  const [reviewing, setReviewing] = useState(false);

  const groups = useMemo(() => {
    const byJob = new Map<string, SubsNeededNobodyRow[]>();
    for (const row of data.nobody) {
      const list = byJob.get(row.projectId) ?? [];
      list.push(row);
      byJob.set(row.projectId, list);
    }
    return Array.from(byJob.values());
  }, [data.nobody]);

  if (!data.nobody.length) {
    return <p className="text-sm text-muted-foreground">Every work phase in the next 14 days has somebody on it.</p>;
  }

  const suggestable = data.nobody.filter((r) => r.suggestions.length > 0);

  return (
    <div className="flex flex-col gap-5">
      {suggestable.length > 0 && !reviewing && (
        <Button variant="outline" className="h-11 self-start" onClick={() => setReviewing(true)}>
          Assign all suggested (review)
        </Button>
      )}
      {reviewing && (
        <ReviewAll
          rows={suggestable}
          onDone={() => {
            setReviewing(false);
            onChanged();
            onReload();
          }}
          onCancel={() => setReviewing(false)}
        />
      )}
      {!reviewing &&
        groups.map((rows) => (
          <section key={rows[0].projectId} className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">
              {rows[0].projectName}
              {rows[0].projectNumber && (
                <span className="pl-2 text-xs font-normal text-muted-foreground">{rows[0].projectNumber}</span>
              )}
            </h3>
            {rows.map((row) => (
              <NobodyRow key={row.phaseId} row={row} directory={data.directory} onChanged={onChanged} />
            ))}
          </section>
        ))}
    </div>
  );
}

function emailLine(isConfirmed: boolean, names: { name: string; hasEmail: boolean }[]): string {
  if (!names.length) return "";
  if (!isConfirmed) return "Penciled in: saving emails nobody.";
  const withEmail = names.filter((n) => n.hasEmail).map((n) => n.name);
  const without = names.filter((n) => !n.hasEmail).map((n) => n.name);
  const parts: string[] = [];
  if (withEmail.length) parts.push(`Saving emails ${withEmail.join(", ")} “You're scheduled”.`);
  if (without.length) parts.push(`No email on file for ${without.join(", ")}, so they aren't emailed.`);
  return parts.join(" ");
}

function NobodyRow({
  row,
  directory,
  onChanged,
}: {
  row: SubsNeededNobodyRow;
  directory: SubsNeededData["directory"];
  onChanged: () => void;
}) {
  const [pick, setPick] = useState<{ id: string; name: string; hasEmail: boolean; aliasOffer: string | null } | null>(null);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ names: string[]; emailed: string[] } | null>(null);
  const [aliasOffer, setAliasOffer] = useState<{ subId: string; subName: string; alias: string } | null>(null);
  const hint = row.notesHint;

  const assign = async () => {
    if (!pick) return;
    setSaving(true);
    setError(null);
    try {
      const res = await assignSubsToPhases({ items: [{ phaseId: row.phaseId, projectId: row.projectId, subIds: [pick.id] }] });
      const r = res.results[0];
      if (res.error || r?.error) {
        setError(res.error ?? r?.error ?? "Couldn't save.");
        return;
      }
      setDone({ names: r?.added.length ? r.added : [pick.name], emailed: r?.emailed ?? [] });
      setAliasOffer(res.aliasOffers[0] ?? null);
      onChanged();
    } catch {
      setError("Couldn't save. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="min-w-0 flex-1 text-sm font-medium">{row.name}</span>
        <span className="text-xs text-muted-foreground">{fmtRange(row.startDate, row.endDate)}</span>
      </div>
      <div className="flex flex-wrap gap-1.5 pt-1.5">
        <Tag tone={row.isConfirmed ? "green" : "amber"}>{row.isConfirmed ? "Confirmed" : "Penciled in"}</Tag>
        {row.tradeLabel && <Tag tone="muted">{row.tradeLabel}</Tag>}
        {row.phaseScope === "master" && <Tag tone="muted">Master schedule</Tag>}
      </div>

      {done ? (
        <div className="flex flex-col gap-2 pt-3">
          <p className="flex items-center gap-2 text-sm text-green-400">
            <Check className="h-4 w-4 shrink-0" aria-hidden />
            {done.names.join(", ")} {done.names.length === 1 ? "is" : "are"} on it.{" "}
            {done.emailed.length ? `Emailed ${done.emailed.join(", ")}.` : "Nobody was emailed."}
          </p>
          {aliasOffer && <AliasOffer offer={aliasOffer} />}
        </div>
      ) : (
        <>
          {row.notesHint && (
            <p className="pt-2 text-sm text-muted-foreground">
              {row.notesHint.matched.toLowerCase() === row.notesHint.subName.toLowerCase() ? (
                <>Notes name {row.notesHint.subName}</>
              ) : (
                <>
                  Notes say <span className="text-foreground">“{row.notesHint.matched}”</span> → {row.notesHint.subName}
                </>
              )}
              {hint && !row.suggestions.some((s) => s.subId === hint.subId) && (
                <button
                  type="button"
                  onClick={() => {
                    const entry = directory.find((d) => d.id === hint.subId);
                    setPick({ id: hint.subId, name: hint.subName, hasEmail: !!entry?.hasEmail, aliasOffer: null });
                  }}
                  className="ml-2 inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-sm text-foreground hover:border-primary"
                >
                  Pick {hint.subName}
                </button>
              )}
            </p>
          )}
          <div className="flex flex-wrap gap-2 pt-2.5">
            {row.suggestions.map((s) => {
              const on = pick?.id === s.subId;
              return (
                <button
                  key={s.subId}
                  type="button"
                  onClick={() => setPick(on ? null : { id: s.subId, name: s.name, hasEmail: s.hasEmail, aliasOffer: s.aliasOffer })}
                  className={cn(
                    "flex min-h-11 flex-col items-start justify-center rounded-lg border px-3 py-1.5 text-left",
                    on ? "border-primary bg-primary/15" : "border-border hover:border-primary/60",
                  )}
                >
                  <span className="text-sm font-medium">{s.name}</span>
                  <span className="text-xs text-muted-foreground">{s.reason}</span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setSearching((v) => !v)}
              className="flex min-h-11 items-center rounded-lg border border-dashed border-border px-3 text-sm text-muted-foreground hover:border-primary hover:text-primary"
            >
              {searching ? "Hide list" : row.suggestions.length ? "Someone else…" : "Pick a sub…"}
            </button>
          </div>
          {searching && (
            <SubSearch
              directory={directory}
              selectedId={pick?.id ?? null}
              onPick={(s) => {
                setPick({ id: s.id, name: s.name, hasEmail: s.hasEmail, aliasOffer: null });
                setSearching(false);
              }}
            />
          )}
          {pick && (
            <div className="flex flex-col gap-2 pt-3">
              <p className="text-xs text-muted-foreground">{emailLine(row.isConfirmed, [pick])}</p>
              <Button className="h-11 self-start" onClick={assign} disabled={saving}>
                {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
                Assign {pick.name}
              </Button>
            </div>
          )}
          {error && <ErrorLine>{error}</ErrorLine>}
        </>
      )}
    </div>
  );
}

function ReviewAll({
  rows,
  onDone,
  onCancel,
}: {
  rows: SubsNeededNobodyRow[];
  onDone: () => void;
  onCancel: () => void;
}) {
  // Job-specific evidence starts ticked; "does this trade" picks wait for a tick.
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(rows.filter((r) => (r.suggestions[0]?.rank ?? 99) <= STRONG_RANK).map((r) => r.phaseId)),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ saved: number; emailed: string[]; failed: number } | null>(null);

  const chosen = rows.filter((r) => checked.has(r.phaseId));
  const willEmail = Array.from(
    new Set(chosen.filter((r) => r.isConfirmed && r.suggestions[0]?.hasEmail).map((r) => r.suggestions[0].name)),
  );

  const save = async () => {
    if (!chosen.length) return;
    setSaving(true);
    setError(null);
    try {
      const res = await assignSubsToPhases({
        items: chosen.map((r) => ({ phaseId: r.phaseId, projectId: r.projectId, subIds: [r.suggestions[0].subId] })),
      });
      if (res.error && !res.results.length) {
        setError(res.error);
        return;
      }
      setOutcome({
        saved: res.results.filter((r) => !r.error).length,
        failed: res.results.filter((r) => r.error).length,
        emailed: Array.from(new Set(res.results.flatMap((r) => r.emailed))),
      });
    } catch {
      setError("Couldn't save. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  if (outcome) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <p className="flex items-center gap-2 text-sm text-green-400">
          <Check className="h-4 w-4 shrink-0" aria-hidden />
          Saved {outcome.saved} phase{outcome.saved === 1 ? "" : "s"}.
          {outcome.emailed.length ? ` Emailed ${outcome.emailed.join(", ")}.` : " Nobody was emailed."}
        </p>
        {outcome.failed > 0 && <ErrorLine>{outcome.failed} didn&apos;t save; they&apos;re still on the list.</ErrorLine>}
        <Button className="h-11 self-start" onClick={onDone}>
          Back to the list
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-sm">
        Each ticked phase gets its first suggestion. Picks from billing history alone start unticked.
      </p>
      <ul className="flex flex-col divide-y divide-border">
        {rows.map((r) => {
          const s = r.suggestions[0];
          const on = checked.has(r.phaseId);
          return (
            <li key={r.phaseId}>
              <label className="flex min-h-[60px] cursor-pointer items-center gap-3 py-2">
                <Checkbox
                  checked={on}
                  onCheckedChange={(v) =>
                    setChecked((prev) => {
                      const next = new Set(prev);
                      if (v === true) next.add(r.phaseId);
                      else next.delete(r.phaseId);
                      return next;
                    })
                  }
                  aria-label={`Assign ${s.name} to ${r.name}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">
                    {r.projectName} · {r.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    → {s.name} · {s.reason} · {fmtRange(r.startDate, r.endDate)}
                    {r.isConfirmed ? (s.hasEmail ? " · emails them" : " · no email on file") : " · penciled in"}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">
        {willEmail.length
          ? `Saving emails ${willEmail.join(", ")} “You're scheduled” (confirmed phases only).`
          : "Saving emails nobody: every ticked phase is penciled in."}
      </p>
      {error && <ErrorLine>{error}</ErrorLine>}
      <div className="flex flex-wrap gap-2">
        <Button className="h-11" onClick={save} disabled={saving || chosen.length === 0}>
          {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
          Save {chosen.length}
        </Button>
        <Button variant="outline" className="h-11" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** "Remember: 'Marcio' in notes means MGL Tile Inc" — saved only on this tap. */
export function AliasOffer({ offer }: { offer: { subId: string; subName: string; alias: string } }) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "dismissed">("idle");
  const [error, setError] = useState<string | null>(null);
  if (state === "dismissed") return null;
  if (state === "saved") {
    return (
      <p className="text-xs text-muted-foreground">
        Saved. “{offer.alias}” in notes now points to {offer.subName}.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        className="h-11"
        disabled={state === "saving"}
        onClick={async () => {
          setState("saving");
          setError(null);
          const res = await saveSubAlias({ subId: offer.subId, alias: offer.alias }).catch(() => ({ error: "Couldn't save.", aliases: [] }));
          if (res.error) {
            setError(res.error);
            setState("idle");
          } else setState("saved");
        }}
      >
        Remember: “{offer.alias}” in notes means {offer.subName}
      </Button>
      <button type="button" className="h-11 px-2 text-xs text-muted-foreground hover:text-foreground" onClick={() => setState("dismissed")}>
        Not now
      </button>
      {error && <ErrorLine>{error}</ErrorLine>}
    </div>
  );
}

function SubSearch({
  directory,
  selectedId,
  onPick,
}: {
  directory: SubsNeededData["directory"];
  selectedId: string | null;
  onPick: (s: SubsNeededData["directory"][number]) => void;
}) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const list = query
    ? directory.filter((s) => `${s.name} ${s.trades.join(" ")}`.toLowerCase().includes(query))
    : directory;
  return (
    <div className="mt-2 flex flex-col gap-1 rounded-lg border border-border bg-muted/20 p-2.5">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search subs or trades"
        autoFocus
        className="h-11 w-full rounded-md bg-background px-3 text-base outline-none ring-1 ring-border focus:ring-primary sm:text-sm"
      />
      <div className="max-h-64 overflow-y-auto pt-1">
        {list.slice(0, 80).map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onPick(s)}
            className={cn(
              "flex min-h-11 w-full items-center gap-3 rounded-md px-2.5 text-left text-sm hover:bg-muted",
              selectedId === s.id && "bg-primary/15",
            )}
          >
            <span className="min-w-0 flex-1 truncate">{s.name}</span>
            {s.trades.length > 0 && (
              <span className="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">{s.trades.join(", ").replace(/_/g, " ")}</span>
            )}
          </button>
        ))}
        {list.length === 0 && <p className="px-2.5 py-3 text-sm text-muted-foreground">No sub matches that.</p>}
      </div>
    </div>
  );
}

// ── Penciled in, starting within 7 days ─────────────────────────

function PenciledList({ rows, onChanged }: { rows: SubsNeededPenciledRow[]; onChanged: () => void }) {
  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">No penciled-in subs start in the next 7 days.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => (
        <PenciledRowView key={row.phaseId} row={row} onChanged={onChanged} />
      ))}
    </div>
  );
}

function PenciledRowView({ row, onChanged }: { row: SubsNeededPenciledRow; onChanged: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ emailed: string[]; skipped: string[]; notifyError: string | null } | null>(null);

  const confirm = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await confirmAndNotify({ phaseId: row.phaseId, projectId: row.projectId });
      if (res.error) setError(res.error);
      else {
        setDone({ emailed: res.emailed, skipped: res.skipped, notifyError: res.notifyError });
        onChanged();
      }
    } catch {
      setError("Couldn't confirm. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="min-w-0 flex-1 text-sm font-medium">
          {row.projectName} · {row.name}
        </span>
        <span className="text-xs text-muted-foreground">{fmtRange(row.startDate, row.endDate)}</span>
      </div>
      <p className="pt-1 text-sm text-muted-foreground">{row.people.map((p) => p.name).join(", ")}</p>
      {done ? (
        <p className="flex items-start gap-2 pt-2 text-sm text-green-400">
          <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            Confirmed. {done.emailed.length ? `Emailed ${done.emailed.join(", ")}.` : "Nobody was emailed."}
            {done.skipped.length > 0 && ` No email on file for ${done.skipped.join(", ")}.`}
            {done.notifyError && ` ${done.notifyError}`}
          </span>
        </p>
      ) : (
        <div className="flex flex-col gap-2 pt-2">
          {row.gate ? (
            <p className="text-xs text-amber-400">{row.gate}</p>
          ) : (
            <p className="text-xs text-muted-foreground">{emailLine(true, row.people)}</p>
          )}
          <Button className="h-11 self-start" onClick={confirm} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
            Confirm &amp; notify
          </Button>
          {error && <ErrorLine>{error}</ErrorLine>}
        </div>
      )}
    </div>
  );
}

// ── Unscheduled sub today ───────────────────────────────────────

function UnscheduledList({ rows, onChanged }: { rows: SubsNeededUnscheduledRow[]; onChanged: () => void }) {
  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">Every sub on site today is on the schedule there.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => (
        <UnscheduledRowView key={row.key} row={row} onChanged={onChanged} />
      ))}
    </div>
  );
}

function UnscheduledRowView({ row, onChanged }: { row: SubsNeededUnscheduledRow; onChanged: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const put = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await putSubOnToday({ subId: row.subId, projectId: row.projectId });
      if (res.error) setError(res.error);
      else {
        setDone(res.scope ?? row.scope);
        onChanged();
      }
    } catch {
      setError("Couldn't save. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const facts = [
    row.checkedIn && row.firstSeenLabel ? `checked in ${row.firstSeenLabel}` : row.firstSeenLabel ? `posted ${row.firstSeenLabel}` : null,
    `${row.posts} post${row.posts === 1 ? "" : "s"}`,
    row.photos ? `${row.photos} photo${row.photos === 1 ? "" : "s"}` : null,
  ].filter(Boolean);

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-sm font-medium">
        {row.subName} at {row.projectName}
      </p>
      <p className="pt-0.5 text-xs text-muted-foreground">{facts.join(" · ")} · not on the schedule there</p>
      {done ? (
        <p className="flex items-center gap-2 pt-2 text-sm text-green-400">
          <Check className="h-4 w-4 shrink-0" aria-hidden />
          On today as “{done}”, penciled in. Nobody was emailed.
        </p>
      ) : (
        <div className="flex flex-col gap-2 pt-2">
          <p className="text-xs text-muted-foreground">
            Adds “{row.scope}” for today on the crew board, penciled in. Nobody is emailed.
          </p>
          <Button className="h-11 self-start" onClick={put} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
            Put {row.subName} on today
          </Button>
          {error && <ErrorLine>{error}</ErrorLine>}
        </div>
      )}
    </div>
  );
}

// ── Bits ────────────────────────────────────────────────────────

function Tag({ tone, children }: { tone: "green" | "amber" | "muted"; children: React.ReactNode }) {
  const tones = {
    green: "bg-green-500/15 text-green-400",
    amber: "bg-amber-500/15 text-amber-400",
    muted: "bg-muted text-muted-foreground",
  } as const;
  return <span className={cn("rounded-full px-2.5 py-0.5 text-xs", tones[tone])}>{children}</span>;
}

function ErrorLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-sm text-red-400">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      {children}
    </p>
  );
}

function fmtDay(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function fmtRange(start: string, end: string) {
  return start === end ? fmtDay(start) : `${fmtDay(start)} – ${fmtDay(end)}`;
}
