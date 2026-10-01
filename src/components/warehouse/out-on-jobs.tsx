"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowDownToLine, PackageCheck, Truck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { closeCheckoutAsUsed } from "@/lib/actions/warehouse";
import type { WarehouseEmployee } from "@/lib/actions/warehouse";
import {
  DEFAULT_OVERDUE_DAYS,
  OVERDUE_DAY_OPTIONS,
  checkoutFacets,
  checkoutPersonKey,
  daysOut,
  daysOutLabel,
  formatQty,
  formatShopDate,
} from "@/lib/warehouse/checkouts";
import { ItemThumb } from "./item-photo";
import { CheckInDialog } from "./check-in-dialog";
import type { WarehouseOpenCheckout } from "@/types/database";

interface OutOnJobsProps {
  checkouts: WarehouseOpenCheckout[];
  employees: WarehouseEmployee[];
  thumbUrls: Record<string, string>;
}

const ALL = "all";

/**
 * Everything currently checked out: item, qty, job site, who took it, date
 * out, days out. Filter by job and by person; anything out longer than the
 * chosen number of days is flagged.
 */
export function OutOnJobs({ checkouts, employees, thumbUrls }: OutOnJobsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [job, setJob] = useState(ALL);
  const [person, setPerson] = useState(ALL);
  const [overdueDays, setOverdueDays] = useState<number>(DEFAULT_OVERDUE_DAYS);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [checkInId, setCheckInId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const facets = useMemo(() => checkoutFacets(checkouts), [checkouts]);

  const rows = useMemo(
    () =>
      checkouts.map((c) => {
        const days = daysOut(c.checked_out_at);
        return { c, days, overdue: days > overdueDays };
      }),
    [checkouts, overdueDays]
  );

  const overdueCount = rows.filter((r) => r.overdue).length;

  const visible = rows.filter(({ c, overdue }) => {
    if (job !== ALL && (c.project_id ?? "none") !== job) return false;
    if (person !== ALL && checkoutPersonKey(c) !== person) return false;
    if (overdueOnly && !overdue) return false;
    return true;
  });

  const markUsed = (c: WarehouseOpenCheckout) => {
    const left = `${formatQty(c.quantity_outstanding)} ${c.unit}`;
    if (
      !confirm(
        `Mark the ${left} of "${c.item_name}" still out as used up on ${c.project_name ?? "the job"}? ` +
          "Nothing comes back into stock and it drops off this list."
      )
    )
      return;
    setError(null);
    startTransition(async () => {
      const result = await closeCheckoutAsUsed(c.id);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/15 text-blue-500">
              <Truck className="h-4.5 w-4.5" />
            </div>
            <div>
              <p className="text-xl font-bold leading-tight">{checkouts.length}</p>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Out on jobs
              </p>
            </div>
          </div>
        </Card>
        <button type="button" onClick={() => setOverdueOnly((v) => !v)} className="text-left">
          <Card
            className={cn(
              "h-full p-4 transition-colors hover:border-amber-500/40",
              overdueOnly && "border-amber-500/60"
            )}
          >
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                  overdueCount > 0
                    ? "bg-red-500/15 text-red-500"
                    : "bg-emerald-500/15 text-emerald-500"
                )}
              >
                <AlertTriangle className="h-4.5 w-4.5" />
              </div>
              <div>
                <p
                  className={cn(
                    "text-xl font-bold leading-tight",
                    overdueCount > 0 && "text-red-500"
                  )}
                >
                  {overdueCount}
                </p>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Out over {overdueDays} days
                </p>
              </div>
            </div>
          </Card>
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select value={job} onValueChange={setJob}>
          <SelectTrigger className="sm:w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All jobs</SelectItem>
            {facets.jobs.map((j) => (
              <SelectItem key={j.id} value={j.id}>
                {j.label} ({j.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={person} onValueChange={setPerson}>
          <SelectTrigger className="sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Everyone</SelectItem>
            {facets.people.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label} ({p.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground sm:ml-auto">
          <span>Flag after</span>
          {OVERDUE_DAY_OPTIONS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setOverdueDays(d)}
              className={cn(
                "rounded-full border px-2.5 py-1 transition-colors",
                overdueDays === d
                  ? "border-amber-500/40 bg-amber-500/15 font-medium text-amber-600 dark:text-amber-400"
                  : "border-border hover:border-amber-500/40"
              )}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* List */}
      {checkouts.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          <PackageCheck className="mx-auto mb-3 h-10 w-10 opacity-40" />
          <p className="mb-1 font-medium text-foreground">Everything is in</p>
          <p className="text-sm">
            Nothing is checked out right now. Use Check Out on the Warehouse page when
            something leaves for a job.
          </p>
        </Card>
      ) : visible.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Nothing out matches these filters.
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map(({ c, days, overdue }) => (
            <Card
              key={c.id}
              className={cn(
                "flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:p-4",
                overdue && "border-red-500/40"
              )}
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <ItemThumb url={thumbUrls[c.item_id]} name={c.item_name} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/warehouse/items/${c.item_id}`}
                      className="truncate font-medium hover:underline"
                    >
                      {c.item_name}
                    </Link>
                    {overdue && (
                      <Badge variant="destructive" className="shrink-0 text-[10px]">
                        Out {days} days
                      </Badge>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {c.project_name ?? "No job"} · {c.employee_name ?? "Unknown"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Out {formatShopDate(c.checked_out_at)} · {daysOutLabel(days)}
                    {c.quantity_returned > 0 && (
                      <> · {formatQty(c.quantity_returned)} back already</>
                    )}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xl font-bold leading-tight">
                    {formatQty(c.quantity_outstanding)}
                  </p>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {c.unit}
                    {c.quantity_returned > 0 && <> of {formatQty(c.quantity_out)}</>}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" className="flex-1 sm:flex-none" onClick={() => setCheckInId(c.id)}>
                  <ArrowDownToLine className="mr-1 h-4 w-4" />
                  Check in
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 sm:flex-none"
                  onClick={() => markUsed(c)}
                  disabled={pending}
                >
                  Used up
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {checkInId && (
        <CheckInDialog
          key={checkInId}
          open
          onOpenChange={(open) => !open && setCheckInId(null)}
          checkouts={checkouts}
          employees={employees}
          initialCheckoutId={checkInId}
          thumbUrls={thumbUrls}
        />
      )}
    </div>
  );
}
