"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Pencil,
  Trash2,
  MapPin,
  User,
  DollarSign,
  CalendarDays,
  Calculator,
  FileText,
  Camera,
  ClipboardList,
  ChevronDown,
  ChevronUp,
  Plus,
  Receipt,
  Loader2,
  Send,
} from "lucide-react";
import { ProjectStatusBadge } from "./project-status-badge";
import { ProjectFormDialog } from "./project-form-dialog";
import { ProjectDeleteDialog } from "./project-delete-dialog";
import { PROJECT_TYPE_LABELS } from "@/lib/constants/project";
import type { Project, Customer, Estimate } from "@/types/database";

interface TeamMember {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
}

interface ProjectDetailProps {
  project: Project;
  customer: Customer | null;
  customers: Customer[];
  teamMembers: TeamMember[];
  pmName: string | null;
  estimatorName: string | null;
  estimates: Estimate[];
}

const formatCurrency = (val: number | null) =>
  val != null
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(val)
    : "—";

export function ProjectDetail({
  project,
  customer,
  customers,
  teamMembers,
  pmName,
  estimatorName,
  estimates,
}: ProjectDetailProps) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [changeOrdersOpen, setChangeOrdersOpen] = useState(false);
  const [receiptsOpen, setReceiptsOpen] = useState(false);

  const address = [project.address, project.city, project.state, project.zip]
    .filter(Boolean)
    .join(", ");

  const customerName = customer
    ? `${customer.first_name} ${customer.last_name}`
    : null;

  const latestEstimate = estimates.length > 0 ? estimates[0] : null;

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-2xl font-bold">{project.name}</h2>
              <ProjectStatusBadge status={project.status} />
              <Badge variant="secondary" className="text-xs">
                {PROJECT_TYPE_LABELS[project.project_type]}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span className="font-mono">{project.project_number}</span>
              {address && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {address}
                </span>
              )}
              {customerName && (
                <span className="flex items-center gap-1">
                  <User className="h-3.5 w-3.5" />
                  {customerName}
                </span>
              )}
              {(pmName || estimatorName) && (
                <span className="text-xs">
                  {pmName && `PM: ${pmName}`}
                  {pmName && estimatorName && " · "}
                  {estimatorName && `Est: ${estimatorName}`}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              Edit
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Delete
            </Button>
          </div>
        </div>

        {project.description && (
          <p className="text-sm text-muted-foreground max-w-2xl">
            {project.description}
          </p>
        )}
      </div>

      {/* ── Financial Summary Bar ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border bg-card p-3">
          <div className="text-xs text-muted-foreground mb-1">Contract Value</div>
          <div className="text-lg font-bold">
            {formatCurrency(project.contract_value)}
          </div>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <div className="text-xs text-muted-foreground mb-1">Estimated Value</div>
          <div className="text-lg font-bold">
            {formatCurrency(project.estimated_value)}
          </div>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <div className="text-xs text-muted-foreground mb-1">Change Orders</div>
          <div className="text-lg font-bold text-muted-foreground">$0</div>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <div className="text-xs text-muted-foreground mb-1">Receipts</div>
          <div className="text-lg font-bold text-muted-foreground">$0</div>
        </div>
      </div>

      {/* ── Original Estimate ── */}
      <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3">
        <Calculator className="h-5 w-5 text-orange-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium">Original Estimate</span>
          {latestEstimate && (
            <span className="text-sm text-muted-foreground ml-2">
              {latestEstimate.name} — {formatCurrency(latestEstimate.total_price)}
            </span>
          )}
        </div>
        {latestEstimate ? (
          <Link href={`/projects/${project.id}/estimates/${latestEstimate.id}`}>
            <Button variant="outline" size="sm">
              <FileText className="mr-1.5 h-3.5 w-3.5" />
              View Estimate
            </Button>
          </Link>
        ) : (
          <span className="text-xs text-muted-foreground">No estimate linked</span>
        )}
      </div>

      {/* ── Schedule (expandable) ── */}
      <ExpandableSection
        icon={<CalendarDays className="h-5 w-5 text-blue-500" />}
        title="Schedule"
        subtitle={
          project.estimated_start_date
            ? `${new Date(project.estimated_start_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })} — ${project.estimated_end_date ? new Date(project.estimated_end_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "TBD"}`
            : "No dates set"
        }
        open={scheduleOpen}
        onToggle={() => setScheduleOpen(!scheduleOpen)}
      >
        <p className="text-sm text-muted-foreground py-4 text-center">
          Schedule phases are managed below.
        </p>
      </ExpandableSection>

      {/* ── Daily Logs ── */}
      <ExpandableSection
        icon={<ClipboardList className="h-5 w-5 text-green-500" />}
        title="Daily Logs"
        subtitle="Track daily progress, weather, and crew"
        open={logsOpen}
        onToggle={() => setLogsOpen(!logsOpen)}
        actionLabel="New Log"
      >
        <div className="text-center py-8 text-sm text-muted-foreground">
          No daily logs yet. Start logging to track job progress.
        </div>
      </ExpandableSection>

      {/* ── Change Orders ── */}
      <ExpandableSection
        icon={<FileText className="h-5 w-5 text-purple-500" />}
        title="Change Orders"
        subtitle="Scope changes and price adjustments"
        open={changeOrdersOpen}
        onToggle={() => setChangeOrdersOpen(!changeOrdersOpen)}
        actionLabel="New CO"
      >
        <div className="text-center py-8 text-sm text-muted-foreground">
          No change orders yet.
        </div>
      </ExpandableSection>

      {/* ── Receipts ── */}
      <ExpandableSection
        icon={<Receipt className="h-5 w-5 text-amber-500" />}
        title="Receipts"
        subtitle="Photos of purchase receipts"
        open={receiptsOpen}
        onToggle={() => setReceiptsOpen(!receiptsOpen)}
        actionLabel="Add Receipt"
      >
        <div className="text-center py-8 text-sm text-muted-foreground">
          <Camera className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
          No receipts yet. Snap a photo of a receipt to track expenses.
        </div>
      </ExpandableSection>

      {/* ── Notes ── */}
      {project.notes && (
        <div className="rounded-lg border bg-card px-4 py-3">
          <div className="text-xs font-medium text-muted-foreground mb-1">Notes</div>
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

// ── Expandable Section Component ──
function ExpandableSection({
  icon,
  title,
  subtitle,
  open,
  onToggle,
  actionLabel,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  open: boolean;
  onToggle: () => void;
  actionLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
      >
        {icon}
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium">{title}</span>
          <span className="text-xs text-muted-foreground ml-2">{subtitle}</span>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
      </button>
      {open && (
        <div className="border-t px-4 pb-4">
          {actionLabel && (
            <div className="flex justify-end pt-3 pb-1">
              <Button size="sm" variant="outline">
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                {actionLabel}
              </Button>
            </div>
          )}
          {children}
        </div>
      )}
    </div>
  );
}
