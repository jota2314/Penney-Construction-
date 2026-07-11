"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Pencil,
  Trash2,
  MapPin,
  User,
  CalendarDays,
  Calculator,
  ChevronRight,
  Mail,
  FolderOpen,
  DollarSign,
  Calendar,
  ClipboardList,
  Receipt,
  Link2,
  Mic,
} from "lucide-react";
import { ProjectStatusBadge } from "./project-status-badge";
import { ProjectFormDialog } from "./project-form-dialog";
import { ProjectDeleteDialog } from "./project-delete-dialog";
import { ProjectActivityFeed } from "./project-activity-feed";
import type { ActivityItem } from "./project-activity-feed";
import { MeetingStatusBadge } from "@/components/meetings/meeting-status-badge";
import { NavigationTile } from "@/components/command-center/navigation-tile";
import { MiniBarSegments } from "@/components/command-center/mini-charts";
import { WalkthroughFormDialog } from "@/components/walkthroughs/walkthrough-form-dialog";
import { WalkthroughStatusBadge } from "@/components/walkthroughs/walkthrough-status-badge";
import { PROJECT_TYPE_LABELS } from "@/lib/constants/project";
import type { Project, Customer, Estimate, QuoteRequest, Invoice, Walkthrough } from "@/types/database";

interface TeamMember {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
}

interface ProjectMeeting {
  id: string;
  scheduled_at: string;
  status: string;
  address: string | null;
  city: string | null;
  summary: string | null;
}

interface LinkedEmail {
  id: string;
  direction: string;
  attachments: { filename: string; mimeType: string; size: number; storage_path: string | null }[];
}

interface ProjectFile {
  filename: string;
  mimeType: string;
}

interface ProjectDetailProps {
  project: Project;
  customer: Customer | null;
  /** All customers linked to this project (primary first, then co-owners). */
  linkedCustomers?: Customer[];
  customers: Customer[];
  teamMembers: TeamMember[];
  pmName: string | null;
  estimatorName: string | null;
  estimates: Estimate[];
  activityItems: ActivityItem[];
  meetings?: ProjectMeeting[];
  linkedEmails?: LinkedEmail[];
  quoteRequests?: QuoteRequest[];
  invoices?: Invoice[];
  projectFiles?: ProjectFile[];
  schedulePhaseCount?: number;
  completedPhaseCount?: number;
  punchListCount?: number;
  financials?: {
    budget_cost: number;
    total_actual_cost: number;
    total_payments_received: number;
    outstanding_receivable: number;
    percent_budget_spent: number;
    gross_profit: number;
    projected_profit: number;
    margin_percent: number;
    adjusted_contract: number;
    deposit_received: number;
    actual_labor_cost: number;
    actual_invoiced: number;
  } | null;
  walkthroughs?: Walkthrough[];
  onSwitchTab?: (tab: string) => void;
  canManageDocuments?: boolean;
}

const fmt = (val: number | null) =>
  val != null
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(val)
    : "$0";

export function ProjectDetail({
  project,
  customer,
  linkedCustomers = [],
  customers,
  teamMembers,
  pmName,
  estimatorName,
  estimates,
  activityItems,
  meetings = [],
  linkedEmails = [],
  quoteRequests = [],
  invoices = [],
  projectFiles = [],
  schedulePhaseCount = 0,
  completedPhaseCount = 0,
  punchListCount = 0,
  financials = null,
  walkthroughs = [],
  onSwitchTab,
  canManageDocuments = false,
}: ProjectDetailProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [walkthroughOpen, setWalkthroughOpen] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Full current URL (including returnUrl/filters) so detail pages opened
  // from the Overview tab can bring the user back to exactly this view.
  const returnUrl = encodeURIComponent(
    `${pathname}${searchParams.size > 0 ? `?${searchParams.toString()}` : ""}`
  );

  const address = [project.address, project.city, project.state]
    .filter(Boolean)
    .join(", ");

  // If the join table populated, render every linked customer.
  // Otherwise fall back to the legacy single-customer prop.
  const displayCustomers: Customer[] =
    linkedCustomers.length > 0
      ? linkedCustomers
      : customer
        ? [customer]
        : [];
  const latestEstimate = estimates.length > 0 ? estimates[0] : null;

  // Tile metrics
  const inboundEmails = linkedEmails.filter((e) => e.direction === "inbound").length;
  const outboundEmails = linkedEmails.filter((e) => e.direction !== "inbound").length;
  const receivedQuotesTotal = quoteRequests
    .filter((q) => q.status === "received" || q.status === "accepted")
    .reduce((sum, q) => sum + (q.amount ?? 0), 0);
  const pdfs = projectFiles.filter((f) => f.mimeType?.includes("pdf")).length;
  const images = projectFiles.filter((f) => f.mimeType?.startsWith("image/")).length;
  const otherFiles = projectFiles.length - pdfs - images;

  const totalInvoiced = invoices.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
  const totalPaid = invoices.reduce((sum, i) => sum + (Number(i.paid_amount) || 0), 0);
  const unpaidInvoices = invoices.filter(i => i.payment_status !== "paid").length;
  const budgetValue = project.contract_value || project.estimated_value || 0;
  const scheduleProgress = schedulePhaseCount > 0
    ? Math.round((completedPhaseCount / schedulePhaseCount) * 100)
    : 0;

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="hidden space-y-2 md:block">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold leading-tight sm:text-2xl">
                {project.name}
              </h2>
              <ProjectStatusBadge status={project.status} projectId={project.id} editable />
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-sm text-muted-foreground">
              <span className="hidden font-mono text-xs sm:inline">{project.project_number}</span>
              <Badge variant="secondary" className="text-[10px] h-5">
                {PROJECT_TYPE_LABELS[project.project_type]}
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={() => setEditOpen(true)}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Info row — stacks nicely on mobile */}
        <div className="flex flex-col gap-1 text-sm text-muted-foreground">
          {address && (
            <div className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span>{address}</span>
            </div>
          )}
          {displayCustomers.length > 0 && (
            <div className="flex items-start gap-1.5 flex-wrap">
              <User className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <div className="flex flex-col gap-0.5">
                {displayCustomers.map((c, i) => (
                  <div key={c.id} className="flex items-center gap-2 flex-wrap">
                    <span>
                      {c.first_name} {c.last_name}
                      {i === 0 && displayCustomers.length > 1 && (
                        <span className="text-[10px] text-muted-foreground/70 ml-1.5">
                          (primary)
                        </span>
                      )}
                    </span>
                    {c.phone && (
                      <a
                        href={`tel:${c.phone}`}
                        className="text-orange-600 hover:underline text-xs"
                      >
                        {c.phone}
                      </a>
                    )}
                    {c.email && (
                      <a
                        href={`mailto:${c.email}`}
                        className="text-orange-600 hover:underline text-xs truncate max-w-[200px]"
                      >
                        {c.email}
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {(pmName || estimatorName) && (
            <div className="flex items-center gap-1.5 text-xs">
              {pmName && <span>PM: <span className="font-medium text-foreground">{pmName}</span></span>}
              {pmName && estimatorName && <span>·</span>}
              {estimatorName && <span>Estimator: <span className="font-medium text-foreground">{estimatorName}</span></span>}
            </div>
          )}
        </div>

        {project.description && (
          <p className="text-sm text-muted-foreground">{project.description}</p>
        )}

        {/* Schedule progress bar */}
        {schedulePhaseCount > 0 && (() => {
          const completed = (schedulePhaseCount as number) > 0 ? completedPhaseCount : 0;
          const pct = Math.round((completed / schedulePhaseCount) * 100);
          return (
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Schedule Progress</span>
                <span className="font-medium">{completed} of {schedulePhaseCount} phases — {pct}%</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    pct >= 100 ? "bg-green-500" : pct >= 50 ? "bg-amber-500" : "bg-sky-500"
                  }`}
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              </div>
            </div>
          );
        })()}
      </div>

      {/* Navigation already exposes these tools; keep the overview focused on
          project context and activity instead of repeating every destination. */}
      <div className="hidden">
        <h3 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          At a glance
        </h3>
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => onSwitchTab?.("schedule")}
            className="rounded-2xl border bg-card p-3.5 text-left shadow-sm transition-colors active:bg-muted"
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/15 text-purple-500">
                <Calendar className="h-4 w-4" />
              </span>
              <span className="text-xs font-semibold text-purple-500">{scheduleProgress}%</span>
            </div>
            <div className="text-2xl font-bold tabular-nums">{completedPhaseCount}/{schedulePhaseCount}</div>
            <div className="text-xs text-muted-foreground">Schedule phases</div>
          </button>

          <button
            type="button"
            onClick={() => onSwitchTab?.("emails")}
            className="rounded-2xl border bg-card p-3.5 text-left shadow-sm transition-colors active:bg-muted"
          >
            <span className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/15 text-sky-500">
              <Mail className="h-4 w-4" />
            </span>
            <div className="text-2xl font-bold tabular-nums">{linkedEmails.length}</div>
            <div className="text-xs text-muted-foreground">Project emails</div>
          </button>

          <button
            type="button"
            onClick={() => onSwitchTab?.(canManageDocuments ? "files" : "invoices")}
            className="rounded-2xl border bg-card p-3.5 text-left shadow-sm transition-colors active:bg-muted"
          >
            <span className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/15 text-violet-500">
              {canManageDocuments
                ? <FolderOpen className="h-4 w-4" />
                : <Receipt className="h-4 w-4" />}
            </span>
            <div className="text-2xl font-bold tabular-nums">
              {canManageDocuments ? projectFiles.length : invoices.length}
            </div>
            <div className="text-xs text-muted-foreground">
              {canManageDocuments ? "Project files" : "Invoices"}
            </div>
          </button>

          <button
            type="button"
            onClick={() => onSwitchTab?.("punch-list")}
            className="rounded-2xl border bg-card p-3.5 text-left shadow-sm transition-colors active:bg-muted"
          >
            <span className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/15 text-red-500">
              <ClipboardList className="h-4 w-4" />
            </span>
            <div className="text-2xl font-bold tabular-nums">{punchListCount}</div>
            <div className="text-xs text-muted-foreground">Open punch items</div>
          </button>
        </div>
      </div>

      {/* The former desktop tile dashboard duplicated the tab navigation. */}
      <div className="hidden">
        <NavigationTile
          title="Emails"
          icon={Mail}
          iconColorClass="bg-sky-500/15 text-sky-500"
          metric={linkedEmails.length}
          metricLabel="Emails"
          metricColorClass="text-sky-600 dark:text-sky-400"
          onClick={() => onSwitchTab?.("emails")}
        >
          {linkedEmails.length > 0 && (
            <MiniBarSegments
              segments={[
                { label: "Inbound", value: inboundEmails, color: "bg-sky-500" },
                { label: "Outbound", value: outboundEmails, color: "bg-emerald-500" },
              ]}
            />
          )}
        </NavigationTile>

        <NavigationTile
          title="Quotes"
          icon={DollarSign}
          iconColorClass="bg-orange-500/15 text-orange-500"
          metric={quoteRequests.length}
          metricLabel={quoteRequests.length === 1 ? "Quote" : "Quotes"}
          metricColorClass="text-orange-600 dark:text-orange-400"
          onClick={() => onSwitchTab?.("quotes")}
        >
          {receivedQuotesTotal > 0 && (
            <span className="text-xs text-muted-foreground">
              Received: {fmt(receivedQuotesTotal)}
            </span>
          )}
        </NavigationTile>

        <NavigationTile
          title="Invoices"
          icon={Receipt}
          iconColorClass="bg-emerald-500/15 text-emerald-500"
          metric={invoices.length}
          metricLabel={unpaidInvoices > 0 ? `${unpaidInvoices} unpaid` : "Invoices"}
          metricColorClass="text-emerald-600 dark:text-emerald-400"
          onClick={() => onSwitchTab?.("invoices")}
        >
          {totalInvoiced > 0 && (
            <span className="text-xs text-muted-foreground">
              Total: {fmt(totalInvoiced)}
            </span>
          )}
        </NavigationTile>

        <NavigationTile
          title="Schedule"
          icon={Calendar}
          iconColorClass="bg-purple-500/15 text-purple-500"
          metric={schedulePhaseCount}
          metricLabel="Phases"
          metricColorClass="text-purple-600 dark:text-purple-400"
          onClick={() => onSwitchTab?.("schedule")}
        />

        {canManageDocuments && (
          <NavigationTile
            title="Files"
            icon={FolderOpen}
            iconColorClass="bg-violet-500/15 text-violet-500"
            metric={projectFiles.length}
            metricLabel="Files"
            metricColorClass="text-violet-600 dark:text-violet-400"
            onClick={() => onSwitchTab?.("files")}
          >
            {projectFiles.length > 0 && (
              <div className="flex gap-2 text-[10px] text-muted-foreground">
                {pdfs > 0 && <span>{pdfs} PDF{pdfs !== 1 ? "s" : ""}</span>}
                {images > 0 && <span>{images} img</span>}
                {otherFiles > 0 && <span>{otherFiles} other</span>}
              </div>
            )}
          </NavigationTile>
        )}

        <NavigationTile
          title="Estimates"
          icon={Calculator}
          iconColorClass="bg-amber-500/15 text-amber-600"
          metric={estimates.length}
          metricLabel="Estimates"
          metricColorClass="text-amber-600 dark:text-amber-400"
          href={`/projects/${project.id}/estimates`}
        >
          {latestEstimate && (
            <span className="text-xs text-muted-foreground">
              Latest: {fmt(latestEstimate.total_price)}
            </span>
          )}
        </NavigationTile>

        <NavigationTile
          title="Walkthroughs"
          icon={ClipboardList}
          iconColorClass="bg-rose-500/15 text-rose-500"
          metric={walkthroughs.length}
          metricLabel={walkthroughs.length === 1 ? "Visit" : "Visits"}
          metricColorClass="text-rose-600 dark:text-rose-400"
          onClick={() => setWalkthroughOpen(true)}
        >
          {walkthroughs.length > 0 ? (
            <span className="text-[10px] text-muted-foreground">
              Latest: {new Date(walkthroughs[0].visited_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground">
              Tap to start a new visit
            </span>
          )}
        </NavigationTile>

        <NavigationTile
          title="Client Meeting"
          icon={Mic}
          iconColorClass="bg-violet-500/15 text-violet-500"
          metric="Record"
          metricLabel="Meeting with client"
          metricColorClass="text-violet-600 dark:text-violet-400"
          href={`/meetings/new?project=${project.id}`}
        >
          <span className="text-[10px] text-muted-foreground">
            Record → AI summary → to-dos
          </span>
        </NavigationTile>

        <NavigationTile
          title="Punch List"
          icon={ClipboardList}
          iconColorClass="bg-red-500/15 text-red-500"
          metric={punchListCount}
          metricLabel={punchListCount === 1 ? "Open item" : "Open items"}
          metricColorClass="text-red-600 dark:text-red-400"
          onClick={() => onSwitchTab?.("punch-list")}
        />

        <NavigationTile
          title="Client Portal"
          icon={Link2}
          iconColorClass="bg-cyan-500/15 text-cyan-500"
          metric="Open"
          metricLabel="Client access"
          metricColorClass="text-cyan-600 dark:text-cyan-400"
          onClick={() => onSwitchTab?.("portal")}
        />

        <NavigationTile
          title="Finances"
          icon={DollarSign}
          iconColorClass="bg-green-500/15 text-green-500"
          metric={(financials?.adjusted_contract || budgetValue) > 0 ? fmt(financials?.adjusted_contract || budgetValue) : "—"}
          metricLabel={financials && financials.adjusted_contract > budgetValue ? "Budget" : "Contract"}
          metricColorClass="text-green-600 dark:text-green-400"
          onClick={() => onSwitchTab?.("finances")}
        >
          {financials ? (() => {
            const cashFlow = financials.total_payments_received - financials.actual_invoiced;
            const cashPositive = cashFlow >= 0;
            const needsInvoice = financials.outstanding_receivable > financials.total_payments_received * 0.5 && financials.percent_budget_spent > 30;
            const pctSpent = financials.percent_budget_spent;
            const pctCollected = financials.adjusted_contract > 0
              ? Math.round((financials.total_payments_received / financials.adjusted_contract) * 100)
              : 0;

            return (
              <div className="space-y-1.5 mt-0.5">
                {/* Mini P&L bar — spent vs collected */}
                <div className="space-y-0.5">
                  <div className="flex justify-between text-[9px] text-muted-foreground">
                    <span>Spent {Math.round(pctSpent)}%</span>
                    <span>Collected {pctCollected}%</span>
                  </div>
                  <div className="relative h-2 rounded-full bg-muted overflow-hidden">
                    {/* Spent bar (red/amber) */}
                    <div
                      className={`absolute left-0 top-0 h-full rounded-full ${pctSpent > 90 ? "bg-red-500" : pctSpent > 70 ? "bg-amber-500" : "bg-amber-400"}`}
                      style={{ width: `${Math.min(pctSpent, 100)}%` }}
                    />
                    {/* Collected overlay (green, on top) */}
                    <div
                      className="absolute left-0 top-0 h-full rounded-full bg-green-500/60"
                      style={{ width: `${Math.min(pctCollected, 100)}%` }}
                    />
                  </div>
                </div>

                {/* Cash flow indicator */}
                <div className={`flex items-center justify-between text-[10px] font-medium ${cashPositive ? "text-green-500" : "text-red-500"}`}>
                  <span>{cashPositive ? "+" : ""}{fmt(cashFlow)} cash</span>
                  <span className={`${financials.margin_percent >= 25 ? "text-green-500" : financials.margin_percent >= 15 ? "text-amber-400" : "text-red-500"}`}>
                    {financials.margin_percent}% margin
                  </span>
                </div>

                {/* Alert: need to invoice client */}
                {needsInvoice && (
                  <div className="text-[9px] font-medium text-red-400 bg-red-500/10 rounded px-1.5 py-0.5 text-center">
                    {fmt(financials.outstanding_receivable)} owed by client
                  </div>
                )}
              </div>
            );
          })() : (
            <div className="flex flex-col text-[10px] text-muted-foreground">
              {quoteRequests.length > 0 && <span>{quoteRequests.length} quotes · {fmt(receivedQuotesTotal)}</span>}
              {invoices.length > 0 && <span>{invoices.length} invoices · {fmt(totalInvoiced)}</span>}
              {totalInvoiced - totalPaid > 0 && <span className="text-amber-500">{fmt(totalInvoiced - totalPaid)} outstanding</span>}
            </div>
          )}
        </NavigationTile>
      </div>

      {/* ── Meetings list ── */}
      {meetings.length > 0 && (
        <div className="hidden space-y-2 md:block">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider px-1">
            Meetings
          </h3>
          {meetings.map((m) => (
            <Link
              key={m.id}
              href={`/crm/meetings/${m.id}?returnUrl=${returnUrl}`}
              className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3 hover:bg-muted/30 active:scale-[0.98] transition-all"
            >
              <div className="h-10 w-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
                <CalendarDays className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">
                  {new Date(m.scheduled_at).toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}{" "}
                  at{" "}
                  {new Date(m.scheduled_at).toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {m.address && `${m.address}${m.city ? `, ${m.city}` : ""}`}
                  {!m.address && m.summary && m.summary.substring(0, 80)}
                </div>
              </div>
              <MeetingStatusBadge status={m.status as "scheduled" | "completed" | "cancelled"} />
              <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
            </Link>
          ))}
        </div>
      )}

      {/* ── Walkthroughs list ── */}
      {walkthroughs.length > 0 && (
        <div className="hidden space-y-2 md:block">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider px-1">
            Walkthroughs
          </h3>
          {walkthroughs.map((wt) => (
            <Link
              key={wt.id}
              href={`/walkthroughs/${wt.id}?returnUrl=${returnUrl}`}
              className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3 hover:bg-muted/30 active:scale-[0.98] transition-all"
            >
              <div className="h-10 w-10 rounded-lg bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center shrink-0">
                <ClipboardList className="h-5 w-5 text-rose-600 dark:text-rose-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{wt.name}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {new Date(wt.visited_at).toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                  {wt.purpose ? ` — ${wt.purpose}` : ""}
                </div>
              </div>
              <WalkthroughStatusBadge status={wt.status} />
              <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
            </Link>
          ))}
        </div>
      )}

      {/* ── Estimates list ── */}
      {estimates.length > 0 && (
        <div className="hidden space-y-2 md:block">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider px-1">
            Estimates
          </h3>
          {estimates.map((est) => (
            <Link
              key={est.id}
              href={`/projects/${project.id}/estimates/${est.id}?returnUrl=${returnUrl}`}
              className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3 hover:bg-muted/30 active:scale-[0.98] transition-all"
            >
              <div className="h-10 w-10 rounded-lg bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center shrink-0">
                <Calculator className="h-5 w-5 text-orange-600 dark:text-orange-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{est.name}</div>
                <div className="text-xs text-muted-foreground truncate">
                  v{est.version} — {fmt(est.total_price)}
                </div>
              </div>
              <Badge variant="secondary" className="text-[10px]">{est.status}</Badge>
              <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
            </Link>
          ))}
        </div>
      )}

      {/* ── Activity Feed ── */}
      <ProjectActivityFeed
        items={activityItems}
        projectId={project.id}
        teamMembers={teamMembers}
      />

      {/* ── Notes ── */}
      {project.notes && (
        <div className="rounded-xl border bg-card px-4 py-3">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
            Notes
          </div>
          <p className="text-sm whitespace-pre-wrap">{project.notes}</p>
        </div>
      )}

      <ProjectFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        project={project}
        customers={customers}
        teamMembers={teamMembers}
      />

      <ProjectDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        project={project}
        redirectOnDelete
      />

      <WalkthroughFormDialog
        open={walkthroughOpen}
        onOpenChange={setWalkthroughOpen}
        presetProject={{
          id: project.id,
          name: project.name,
          address: project.address,
          city: project.city,
          state: project.state,
          zip: project.zip,
        }}
      />
    </div>
  );
}


