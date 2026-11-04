"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Copy, EyeOff, Loader2, Mail, MessageSquare, RotateCcw, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  setSubPortalExcluded,
  type SubInviteSendChannel,
  type SubPortalState,
  type SubRolloutData,
  type SubRolloutRow,
} from "@/lib/actions/sub-portal";
import { fmtShort } from "@/lib/portal-kit/format";
import { AddCellField, SubInviteFlow } from "./sub-invite-flow";
import { SubPortalDialog, invitedLabel } from "./sub-portal-dialog";

type Filter = "all" | "not_invited" | "invited" | "on" | "need_cell" | "hidden";

const PORTAL_PILL: Record<SubPortalState, { label: string; className: string }> = {
  on: { label: "On", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  invited: { label: "Invited", className: "bg-sky-500/15 text-sky-700 dark:text-sky-400" },
  set_up: { label: "PIN set", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  never: { label: "Never", className: "bg-muted text-muted-foreground" },
  off: { label: "Off", className: "bg-red-500/15 text-red-700 dark:text-red-400" },
};

const GRID =
  "lg:grid lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.5fr)_minmax(0,1.4fr)_5rem_6.5rem_6.5rem_4rem_minmax(0,1.2fr)_auto] lg:items-center lg:gap-3";

function isHidden(r: SubRolloutRow): boolean {
  return r.supplier || !!r.excluded_at;
}

function matches(r: SubRolloutRow, f: Filter): boolean {
  if (f === "hidden") return isHidden(r);
  if (isHidden(r)) return false;
  switch (f) {
    case "not_invited":
      return r.portal === "never" || r.portal === "set_up";
    case "invited":
      return r.portal === "invited";
    case "on":
      return r.portal === "on";
    case "need_cell":
      return !r.cell;
    default:
      return true;
  }
}

/**
 * The cross-sub rollout view: who should be on the portal, who has a cell
 * (the login), who was invited and who actually shows up. Every invite is an
 * explicit click; nothing here sends on its own.
 */
export function SubRolloutTable({ data }: { data: SubRolloutData }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [flow, setFlow] = useState<{ row: SubRolloutRow; channel: SubInviteSendChannel } | null>(null);
  const [details, setDetails] = useState<SubRolloutRow | null>(null);
  const [hiding, startHiding] = useTransition();
  const [hidingId, setHidingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, not_invited: 0, invited: 0, on: 0, need_cell: 0, hidden: 0 };
    for (const r of data.rows) {
      for (const f of Object.keys(c) as Filter[]) if (matches(r, f)) c[f] += 1;
    }
    return c;
  }, [data.rows]);

  const rows = data.rows.filter((r) => matches(r, filter));
  const refresh = () => router.refresh();

  function hide(r: SubRolloutRow, excluded: boolean) {
    setError(null);
    setHidingId(r.sub_id);
    startHiding(async () => {
      const res = await setSubPortalExcluded(r.sub_id, excluded);
      if (res.error) setError(res.error);
      setHidingId(null);
      refresh();
    });
  }

  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "not_invited", label: "Not invited" },
    { key: "invited", label: "Invited" },
    { key: "on", label: "On" },
    { key: "need_cell", label: "Need a cell" },
    { key: "hidden", label: "Hidden" },
  ];

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Subs billed in the last 90 days or on the schedule in the next 30. Counts are live as of{" "}
          {new Date(data.generated_at).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            timeZone: "America/New_York",
          })}
          . Material suppliers and anyone you hide are under Hidden.
        </p>
        {data.test_mode && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
            Notifications test mode is on: email invites go to jbetancur@ only, and a real sub&apos;s login
            isn&apos;t touched by them. Texts and copies aren&apos;t affected.
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter subs">
        {filters.map((f) => (
          <button
            key={f.key}
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "h-8 shrink-0 whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors",
              filter === f.key
                ? "border-amber-500 bg-amber-500/15 text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label} <span className="tabular-nums">{counts[f.key]}</span>
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="rounded-xl border">
        <div
          className={cn(
            GRID,
            "hidden border-b px-4 py-2 text-[11px] uppercase tracking-wider text-muted-foreground lg:grid",
          )}
        >
          <span>Sub</span>
          <span>Cell (login)</span>
          <span>Email</span>
          <span>Portal</span>
          <span>Invited</span>
          <span>Last real visit</span>
          <span>Posts 30d</span>
          <span>Last on site</span>
          <span className="text-right">Invite</span>
        </div>

        {rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">Nobody here.</p>
        ) : (
          <ul className="divide-y">
            {rows.map((r) => (
              <RolloutRow
                key={r.sub_id}
                row={r}
                today={data.today}
                busyHiding={hiding && hidingId === r.sub_id}
                onInvite={(channel) => setFlow({ row: r, channel })}
                onDetails={() => setDetails(r)}
                onHide={(excluded) => hide(r, excluded)}
                onChanged={refresh}
              />
            ))}
          </ul>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Last real visit is his last portal page load; page loads before Oct 17 include office previews. Last on
        site comes from job-sign check-ins, posts and clock-ins.
      </p>

      <Dialog
        open={!!flow}
        onOpenChange={(open) => {
          if (!open) setFlow(null);
        }}
      >
        <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="truncate">
              {flow?.channel === "email" ? "Email invite" : flow?.channel === "copy" ? "Copy the invite" : "Text invite"}
              : {flow?.row.company_name}
            </DialogTitle>
          </DialogHeader>
          {flow && (
            <div className="min-w-0 overflow-y-auto">
              <SubInviteFlow
                key={`${flow.row.sub_id}:${flow.channel}`}
                subId={flow.row.sub_id}
                channel={flow.channel}
                onDone={() => setFlow(null)}
                onChanged={refresh}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {details && (
        <SubPortalDialog
          open={!!details}
          onOpenChange={(open) => {
            if (!open) setDetails(null);
          }}
          subcontractor={{
            id: details.sub_id,
            company_name: details.company_name,
            contact_name: details.contact_name,
            phone: details.cell ?? details.phone_on_file,
            email: details.email,
          }}
          onChanged={refresh}
        />
      )}
    </div>
  );
}

function RolloutRow({
  row: r,
  today,
  busyHiding,
  onInvite,
  onDetails,
  onHide,
  onChanged,
}: {
  row: SubRolloutRow;
  today: string;
  busyHiding: boolean;
  onInvite: (channel: SubInviteSendChannel) => void;
  onDetails: () => void;
  onHide: (excluded: boolean) => void;
  onChanged: () => void;
}) {
  const pill = PORTAL_PILL[r.portal];
  const canInvite = !!r.cell && r.portal !== "off" && !isHidden(r);
  const why = [
    r.next_phase
      ? `${r.next_phase.start_date <= today ? "On" : "Next"}: ${r.next_phase.name} at ${r.next_phase.project_name} ${fmtShort(r.next_phase.start_date)}${r.phases_30d > 1 ? ` (+${r.phases_30d - 1} more)` : ""}`
      : null,
    r.bills_90d ? `${r.bills_90d} bill${r.bills_90d === 1 ? "" : "s"} in 90 days, last ${fmtShort(r.last_bill_day)}` : null,
  ].filter(Boolean);

  return (
    <li className={cn(GRID, "space-y-2 px-4 py-3 lg:space-y-0")}>
      {/* sub */}
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <button
            onClick={onDetails}
            className="min-w-0 truncate text-left text-sm font-semibold hover:underline"
            title="Portal details"
          >
            {r.company_name}
          </button>
          <span className={cn("shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium lg:hidden", pill.className)}>
            {pill.label}
          </span>
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {[r.contact_name, r.trades.slice(0, 3).join(", ")].filter(Boolean).join(" · ") || "No contact on file"}
        </p>
        {why.map((w) => (
          <p key={w} className="truncate text-[11px] text-muted-foreground">{w}</p>
        ))}
        {r.supplier && <p className="text-[11px] text-muted-foreground">Material supplier: not invited.</p>}
        {r.excluded_at && <p className="text-[11px] text-muted-foreground">Hidden {fmtShort(r.excluded_at)}.</p>}
      </div>

      {/* cell */}
      <div className="min-w-0 text-sm">
        <MobileLabel>Cell</MobileLabel>
        {r.cell ? (
          <span className="tabular-nums">{r.cell}</span>
        ) : isHidden(r) ? (
          <span className="text-muted-foreground">None</span>
        ) : (
          <AddCellField
            subId={r.sub_id}
            onSaved={onChanged}
            placeholder={r.phone_on_file ? `Fix ${r.phone_on_file}` : "Add cell"}
          />
        )}
      </div>

      {/* email */}
      <div className="min-w-0 text-sm">
        <MobileLabel>Email</MobileLabel>
        <span className={cn("block truncate", !r.email && "text-muted-foreground")} title={r.email ?? undefined}>
          {r.email ?? "None"}
        </span>
      </div>

      {/* portal */}
      <div className="hidden lg:block">
        <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium", pill.className)}>
          {pill.label}
        </span>
      </div>

      <Stat label="Invited">{invitedLabel(r.invited_at, r.invite_channel)}</Stat>
      <Stat label="Last real visit">{r.last_real_visit_at ? fmtShort(r.last_real_visit_at) : "Never"}</Stat>
      <Stat label="Posts 30d">
        <span className="tabular-nums">{r.posts_30d}</span>
      </Stat>
      <Stat label="Last on site">
        {r.last_on_site ? `${r.last_on_site.project_name} · ${fmtShort(r.last_on_site.at)}` : "Never"}
      </Stat>

      {/* actions */}
      <div className="flex flex-wrap items-center gap-1.5 lg:justify-end">
        {!isHidden(r) && (
          <>
            <Button
              size="sm"
              onClick={() => onInvite("text")}
              disabled={!canInvite}
              className="h-8 gap-1.5"
              title={canInvite ? undefined : r.portal === "off" ? "Portal is turned off" : "Add a cell first"}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              {r.has_pin ? "Text" : "Set up + text"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onInvite("email")}
              disabled={!canInvite || !r.email}
              className="h-8 gap-1.5"
              title={!r.email ? "No email on file" : undefined}
            >
              <Mail className="h-3.5 w-3.5" /> Email
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => onInvite("copy")}
              disabled={!canInvite}
              aria-label="Copy the invite"
              title="Copy the invite"
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
        <Button size="icon-sm" variant="ghost" onClick={onDetails} aria-label="Portal details" title="Portal details">
          <Settings2 className="h-3.5 w-3.5" />
        </Button>
        {!r.supplier && (
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => onHide(!r.excluded_at)}
            disabled={busyHiding}
            aria-label={r.excluded_at ? "Show on the list again" : "Hide from this list"}
            title={r.excluded_at ? "Show on the list again" : "Hide from this list"}
          >
            {busyHiding ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : r.excluded_at ? (
              <RotateCcw className="h-3.5 w-3.5" />
            ) : (
              <EyeOff className="h-3.5 w-3.5" />
            )}
          </Button>
        )}
      </div>
    </li>
  );
}

function MobileLabel({ children }: { children: string }) {
  return <span className="mr-2 text-xs text-muted-foreground lg:hidden">{children}</span>;
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2 text-xs lg:block">
      <MobileLabel>{label}</MobileLabel>
      <span className="min-w-0 truncate lg:block">{children}</span>
    </div>
  );
}
