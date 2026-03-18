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
  FileText,
  Camera,
  ClipboardList,
  ChevronRight,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { ProjectStatusBadge } from "./project-status-badge";
import { ProjectFormDialog } from "./project-form-dialog";
import { ProjectDeleteDialog } from "./project-delete-dialog";
import { ProjectActivityFeed } from "./project-activity-feed";
import type { ActivityItem } from "./project-activity-feed";
import { MeetingStatusBadge } from "@/components/meetings/meeting-status-badge";
import { PROJECT_TYPE_LABELS, CRM_STATUSES } from "@/lib/constants/project";
import type { Project, Customer, Estimate, ProjectStatus } from "@/types/database";

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

  const isPreCon = CRM_STATUSES.includes(project.status as ProjectStatus);

  // Financial calculations (construction view only)
  const contractVal = project.contract_value ?? 0;
  const estimatedVal = project.estimated_value ?? 0;
  const changeOrdersTotal = 0; // placeholder — will be real data
  const receiptsTotal = 0; // placeholder — will be real data
  const totalBudget = contractVal + changeOrdersTotal;
  const totalSpent = receiptsTotal;
  const remaining = totalBudget - totalSpent;
  const budgetHealthy = remaining >= 0;

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

      {isPreCon ? (
        <>
          {/* ── Pre-Con Quick Actions ── */}
          <div className="grid grid-cols-2 gap-3">
            <Link href={`/crm/meetings?project=${project.id}`}>
              <QuickAction
                icon={<CalendarDays className="h-6 w-6" />}
                label="Schedule Meeting"
                color="bg-blue-500"
              />
            </Link>
            <Link href={`/projects/${project.id}/estimates/new`}>
              <QuickAction
                icon={<Calculator className="h-6 w-6" />}
                label="Create Estimate"
                color="bg-orange-500"
              />
            </Link>
            <Link href="/walkthroughs">
              <QuickAction
                icon={<Camera className="h-6 w-6" />}
                label="Walkthrough"
                color="bg-emerald-500"
              />
            </Link>
            <Link href={`/projects/${project.id}`}>
              <QuickAction
                icon={<FileText className="h-6 w-6" />}
                label="Send Proposal"
                color="bg-purple-500"
              />
            </Link>
          </div>

          {/* ── Meetings (from lead) ── */}
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

          {/* ── Estimates ── */}
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
        </>
      ) : (
        <>
          {/* ── Budget / Spent — links to budget page (construction only) ── */}
          <Link
            href={`/projects/${project.id}/budget`}
            className="block rounded-xl border-2 border-border bg-card overflow-hidden hover:bg-muted/20 active:scale-[0.99] transition-all"
          >
            <div className="grid grid-cols-2 divide-x divide-border">
              <div className="p-4 sm:p-5">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Budget
                </div>
                <div className="text-2xl sm:text-3xl font-bold mt-1">
                  {fmt(totalBudget || contractVal || estimatedVal)}
                </div>
              </div>
              <div className="p-4 sm:p-5">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Spent
                </div>
                <div className={`text-2xl sm:text-3xl font-bold mt-1 ${totalSpent > 0 ? "text-red-600" : ""}`}>
                  {fmt(totalSpent)}
                </div>
              </div>
            </div>
            <div className="px-4 sm:px-5 pb-3 flex items-center justify-between">
              <div
                className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                  budgetHealthy
                    ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                    : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                }`}
              >
                {budgetHealthy ? (
                  <TrendingUp className="h-3 w-3" />
                ) : (
                  <TrendingDown className="h-3 w-3" />
                )}
                {fmt(Math.abs(remaining))} {budgetHealthy ? "remaining" : "over"}
              </div>
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                View details <ChevronRight className="h-3.5 w-3.5" />
              </span>
            </div>
          </Link>

          {/* ── Construction Quick Actions ── */}
          <div className="grid grid-cols-2 gap-3">
            <QuickAction
              icon={<ClipboardList className="h-6 w-6" />}
              label="Daily Log"
              color="bg-green-500"
              onClick={() => {}}
            />
            <QuickAction
              icon={<Camera className="h-6 w-6" />}
              label="Add Receipt"
              color="bg-amber-500"
              onClick={() => {}}
            />
            <QuickAction
              icon={<FileText className="h-6 w-6" />}
              label="Change Order"
              color="bg-purple-500"
              onClick={() => {}}
            />
            <QuickAction
              icon={<CalendarDays className="h-6 w-6" />}
              label="Schedule"
              color="bg-blue-500"
              onClick={() => {}}
            />
          </div>
        </>
      )}

      {/* ── Activity Feed ── */}
      <ProjectActivityFeed items={activityItems} />

      {/* ── Original Estimate — compact link row (construction view only) ── */}
      {!isPreCon && latestEstimate && (
        <Link
          href={`/projects/${project.id}/estimates/${latestEstimate.id}`}
          className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3 hover:bg-muted/30 active:scale-[0.98] transition-all"
        >
          <div className="h-10 w-10 rounded-lg bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center shrink-0">
            <Calculator className="h-5 w-5 text-orange-600 dark:text-orange-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">Original Estimate</div>
            <div className="text-xs text-muted-foreground truncate">
              {latestEstimate.name} — {fmt(latestEstimate.total_price)}
            </div>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
        </Link>
      )}

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

// ── Quick Action Button (big, touch-friendly) ──
function QuickAction({
  icon,
  label,
  color,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  color: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 rounded-xl border bg-card p-4 hover:bg-muted/30 active:scale-[0.97] transition-all text-left w-full min-h-[64px]"
    >
      <div
        className={`h-11 w-11 rounded-lg ${color} flex items-center justify-center text-white shrink-0`}
      >
        {icon}
      </div>
      <span className="text-sm font-semibold">{label}</span>
    </button>
  );
}

