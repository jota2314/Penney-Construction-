"use client";

import { useState } from "react";
import Link from "next/link";
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
  HardHat,
} from "lucide-react";
import { ProjectStatusBadge } from "./project-status-badge";
import { ProjectFormDialog } from "./project-form-dialog";
import { ProjectDeleteDialog } from "./project-delete-dialog";
import { ProjectActivityFeed } from "./project-activity-feed";
import type { ActivityItem } from "./project-activity-feed";
import { MeetingStatusBadge } from "@/components/meetings/meeting-status-badge";
import { NavigationTile } from "@/components/command-center/navigation-tile";
import { MiniBarSegments } from "@/components/command-center/mini-charts";
import { PROJECT_TYPE_LABELS } from "@/lib/constants/project";
import type { Project, Customer, Estimate, QuoteRequest, Invoice } from "@/types/database";

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
  dailyLogCount?: number;
  totalCrewHours?: number;
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
  onSwitchTab?: (tab: string) => void;
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
  dailyLogCount = 0,
  totalCrewHours = 0,
  financials = null,
  onSwitchTab,
}: ProjectDetailProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const address = [project.address, project.city, project.state]
    .filter(Boolean)
    .join(", ");

  const customerName = customer
    ? `${customer.first_name} ${customer.last_name}`
    : null;

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

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl sm:text-2xl font-bold leading-tight">
                {project.name}
              </h2>
              <ProjectStatusBadge status={project.status} />
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-sm text-muted-foreground">
              <span className="font-mono text-xs">{project.project_number}</span>
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
          {customerName && (
            <div className="flex items-center gap-1.5">
              <User className="h-3.5 w-3.5 shrink-0" />
              <span>{customerName}</span>
              {customer?.phone && (
                <a
                  href={`tel:${customer.phone}`}
                  className="text-orange-600 hover:underline ml-1"
                >
                  {customer.phone}
                </a>
              )}
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
      </div>

      {/* ── Project Command Center Tiles ── */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
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
          title="Schedule"
          icon={Calendar}
          iconColorClass="bg-purple-500/15 text-purple-500"
          metric={schedulePhaseCount}
          metricLabel="Phases"
          metricColorClass="text-purple-600 dark:text-purple-400"
          onClick={() => onSwitchTab?.("schedule")}
        />

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
          title="Finances"
          icon={DollarSign}
          iconColorClass="bg-green-500/15 text-green-500"
          metric={budgetValue > 0 ? fmt(budgetValue) : "—"}
          metricLabel="Contract"
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

        <NavigationTile
          title="Production"
          icon={HardHat}
          iconColorClass="bg-orange-500/15 text-orange-500"
          metric={totalCrewHours > 0 ? `${totalCrewHours}h` : "—"}
          metricLabel="Crew Hours"
          metricColorClass="text-orange-600 dark:text-orange-400"
          onClick={() => onSwitchTab?.("production")}
        >
          {dailyLogCount > 0 && (
            <span className="text-[10px] text-muted-foreground">
              {dailyLogCount} daily {dailyLogCount === 1 ? "report" : "reports"}
            </span>
          )}
        </NavigationTile>
      </div>

      {/* ── Meetings list ── */}
      {meetings.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider px-1">
            Meetings
          </h3>
          {meetings.map((m) => (
            <Link
              key={m.id}
              href={`/crm/meetings/${m.id}`}
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

      {/* ── Estimates list ── */}
      {estimates.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider px-1">
            Estimates
          </h3>
          {estimates.map((est) => (
            <Link
              key={est.id}
              href={`/projects/${project.id}/estimates/${est.id}`}
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
      <ProjectActivityFeed items={activityItems} />

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
    </div>
  );
}


