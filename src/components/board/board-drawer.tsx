"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { AddressLink } from "@/components/ui/address-link";
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
  CheckSquare,
  FileWarning,
  Loader2,
  Package,
} from "lucide-react";
import type { ProjectHealth } from "./job-board";

/**
 * The project drawer — what opens when you click anything on the board.
 *
 * Ordered by how often Jorge needs it: what's happening now, what the field
 * said, then the open loops. Read-only by design; every write still happens
 * on the project page, which the footer links to.
 */

interface DrawerPhase {
  id: string;
  name: string;
  start_date: string;
  end_date: string | null;
  status: string;
  color: string | null;
  is_confirmed: boolean | null;
  phase_scope: string | null;
}

interface DrawerData {
  project: {
    id: string;
    name: string;
    projectNumber: string;
    status: string;
    phase: string | null;
    address: string;
    nextAction: string | null;
    contractValue: number | null;
    startDate: string | null;
    targetEnd: string | null;
  };
  phases: { current: DrawerPhase[]; upcoming: DrawerPhase[]; recent: DrawerPhase[] };
  logs: {
    id: string;
    text: string | null;
    at: string;
    open: boolean;
    author: string;
    hoursAgo: number;
    photos: string[];
  }[];
  todos: {
    id: string;
    description: string;
    dueDate: string | null;
    priority: string;
    overdue: boolean;
  }[];
  orders: {
    id: string;
    label: string;
    orderNumber: string;
    status: string;
    neededBy: string | null;
    overdue: boolean;
  }[];
  changeOrders: {
    id: string;
    number: number | string;
    title: string;
    status: string;
    amount: number | null;
    sent: boolean;
    signed: boolean;
  }[];
}

function shortDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function timeAgo(hours: number) {
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function Section({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: typeof Package;
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        <Icon className="h-3 w-3" aria-hidden />
        {title}
        {count !== undefined && count > 0 && (
          <span className="tabular-nums text-muted-foreground/60">{count}</span>
        )}
      </h3>
      {children}
    </section>
  );
}

export function BoardDrawer({
  projectId,
  health,
  onClose,
}: {
  projectId: string | null;
  health: ProjectHealth | undefined;
  onClose: () => void;
}) {
  // Results carry the id they belong to, so "loading" and "stale" are derived
  // rather than stored. Nothing is set synchronously inside the effect, which
  // is what keeps opening a drawer to one render instead of a cascade.
  const [result, setResult] = useState<{ forId: string; data: DrawerData } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    fetch(`/api/board/project/${projectId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json: DrawerData) => {
        if (!cancelled) setResult({ forId: projectId, data: json });
      })
      .catch(() => {
        if (!cancelled) setFailed(projectId);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const data = result?.forId === projectId ? result.data : null;
  const error = failed === projectId ? "Couldn't load this job." : null;
  const loading = !!projectId && !data && !error;

  const p = data?.project;

  return (
    <Sheet open={!!projectId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader className="space-y-1">
          <SheetTitle className="pr-6 text-base leading-tight">
            {p?.name ?? "Loading…"}
          </SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {p && (
              <>
                <span className="tabular-nums">{p.projectNumber}</span>
                {p.address && (
                  <span>
                    · <AddressLink address={p.address} className="hover:text-amber-500" />
                  </span>
                )}
                {p.contractValue !== null && (
                  <span className="tabular-nums">
                    · ${p.contractValue.toLocaleString()}
                  </span>
                )}
              </>
            )}
          </SheetDescription>
        </SheetHeader>

        {loading && (
          <div className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Reading the job…
          </div>
        )}
        {error && <p className="px-4 py-8 text-sm text-red-400">{error}</p>}

        {data && p && (
          <div className="flex flex-col gap-5 px-4 py-4">
            {health && (health.note || health.issues.length > 0) && (
              <div
                className={`rounded-md border p-3 text-xs leading-relaxed ${
                  health.health === "red"
                    ? "border-red-500/40 bg-red-500/10"
                    : health.health === "yellow"
                      ? "border-amber-500/40 bg-amber-500/10"
                      : "border-border bg-muted/40"
                }`}
              >
                {health.note && <p className="text-foreground">{health.note}</p>}
                {health.issues.map((issue, i) => (
                  <p key={i} className="flex items-start gap-1.5 pt-1 text-muted-foreground">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                    <span>{issue}</span>
                  </p>
                ))}
              </div>
            )}

            <Section icon={CalendarDays} title="Schedule">
              <div className="flex flex-col gap-1.5">
                {data.phases.current.map((ph) => (
                  <PhaseRow key={ph.id} phase={ph} live />
                ))}
                {data.phases.upcoming.map((ph) => (
                  <PhaseRow key={ph.id} phase={ph} />
                ))}
                {data.phases.current.length === 0 && data.phases.upcoming.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Nothing scheduled.
                    {p.status === "in_progress" && " This job is in construction — worth a look."}
                  </p>
                )}
                <p className="pt-1 text-[11px] text-muted-foreground">
                  Started {shortDate(p.startDate)} · target {shortDate(p.targetEnd)}
                </p>
              </div>
            </Section>

            <Section icon={CheckSquare} title="From the field" count={data.logs.length}>
              <div className="flex flex-col gap-3">
                {data.logs.slice(0, 5).map((log) => (
                  <div key={log.id} className="flex flex-col gap-1.5">
                    <div className="flex items-baseline gap-2 text-[11px]">
                      <span className="font-medium text-foreground">{log.author}</span>
                      <span className="text-muted-foreground">{timeAgo(log.hoursAgo)}</span>
                      {log.open && (
                        <span className="rounded bg-green-500/15 px-1.5 text-[10px] text-green-400">
                          on site
                        </span>
                      )}
                    </div>
                    {log.text && (
                      <p className="text-xs leading-relaxed text-muted-foreground">{log.text}</p>
                    )}
                    {log.photos.length > 0 && (
                      <div className="flex gap-1.5 overflow-x-auto">
                        {log.photos.slice(0, 4).map((url) => (
                          <Image
                            key={url}
                            src={url}
                            alt=""
                            width={64}
                            height={64}
                            unoptimized
                            className="h-16 w-16 shrink-0 rounded object-cover"
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {data.logs.length === 0 && (
                  <p className="text-xs text-muted-foreground">No field logs in three weeks.</p>
                )}
              </div>
            </Section>

            {data.changeOrders.length > 0 && (
              <Section icon={FileWarning} title="Change orders" count={data.changeOrders.length}>
                <div className="flex flex-col gap-1">
                  {data.changeOrders.map((co) => (
                    <div key={co.id} className="flex items-center gap-2 text-xs">
                      <span
                        className={`rounded px-1.5 py-px text-[10px] ${
                          co.sent ? "bg-amber-500/15 text-amber-500" : "bg-red-500/15 text-red-400"
                        }`}
                      >
                        {co.sent ? "awaiting signature" : "never sent"}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">
                        #{co.number} {co.title}
                      </span>
                      {co.amount !== null && (
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          ${co.amount.toLocaleString()}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {data.orders.length > 0 && (
              <Section icon={Package} title="Material orders" count={data.orders.length}>
                <div className="flex flex-col gap-1">
                  {data.orders.map((o) => (
                    <div key={o.id} className="flex items-center gap-2 text-xs">
                      <span
                        className={`rounded px-1.5 py-px text-[10px] ${
                          o.overdue
                            ? "bg-red-500/15 text-red-400"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {o.overdue ? "past due" : o.status}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">
                        {o.label}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {shortDate(o.neededBy)}
                      </span>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {data.todos.length > 0 && (
              <Section icon={CheckSquare} title="Open todos" count={data.todos.length}>
                <div className="flex flex-col gap-1">
                  {data.todos.slice(0, 8).map((t) => (
                    <div key={t.id} className="flex items-start gap-2 text-xs">
                      <span
                        className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                          t.overdue ? "bg-red-500" : "bg-muted-foreground/40"
                        }`}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 text-muted-foreground">{t.description}</span>
                      {t.dueDate && (
                        <span
                          className={`shrink-0 text-[11px] ${
                            t.overdue ? "text-red-400" : "text-muted-foreground"
                          }`}
                        >
                          {shortDate(t.dueDate)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </Section>
            )}

            <div className="flex gap-2 border-t border-border pt-4">
              <Button asChild size="sm" className="flex-1">
                <Link href={`/projects/${p.id}`}>
                  Open project
                  <ArrowUpRight className="ml-1 h-3.5 w-3.5" aria-hidden />
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline" className="flex-1">
                <Link href={`/projects/${p.id}?tab=schedule`}>Schedule</Link>
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function PhaseRow({ phase, live }: { phase: DrawerPhase; live?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <span
        className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm"
        style={{ backgroundColor: phase.color || "#f59e0b" }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-xs font-medium">{phase.name}</span>
          {live && (
            <span className="shrink-0 rounded bg-primary/15 px-1.5 text-[10px] text-primary">
              now
            </span>
          )}
          {!phase.is_confirmed && (
            <span className="shrink-0 text-[10px] text-muted-foreground">unconfirmed</span>
          )}
        </div>
        <span className="text-[11px] text-muted-foreground">
          {shortDate(phase.start_date)} – {shortDate(phase.end_date)}
        </span>
        {phase.phase_scope && (
          <p className="line-clamp-2 pt-0.5 text-[11px] leading-snug text-muted-foreground/80">
            {phase.phase_scope}
          </p>
        )}
      </div>
    </div>
  );
}
