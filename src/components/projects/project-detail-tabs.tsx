"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useSearchParamState } from "@/lib/hooks/use-search-param-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  BottomSheet,
  BottomSheetBody,
  BottomSheetContent,
  BottomSheetDescription,
  BottomSheetHeader,
  BottomSheetTitle,
} from "@/components/ui/bottom-sheet";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Mail,
  DollarSign,
  Receipt,
  FolderOpen,
  Calendar,
  ClipboardList,
  HardHat,
  Link2,
  MoreHorizontal,
  ChevronRight,
  Calculator,
  MapPin,
  User,
  Pencil,
  Trash2,
} from "lucide-react";
import { ProjectDetail } from "./project-detail";
import { ProjectStatusBadge } from "./project-status-badge";
import { ProjectFormDialog } from "./project-form-dialog";
import { ProjectDeleteDialog } from "./project-delete-dialog";
import { ProjectEmailsTab } from "./project-emails-tab";
import { ProjectSubsTab, type SubDirectoryEntry } from "./project-subs-tab";
import { ProjectInvoicesTab } from "./project-invoices-tab";
import { ProjectFilesTab } from "./project-files-tab";
import { ProjectFinancesTab } from "./project-finances-tab";
import type { ContractState } from "./payment-schedule-card";
import { ProjectScheduleTab } from "./project-schedule-tab";
import { ProjectPortalTab } from "./project-portal-tab";
import { ProjectPunchListTab } from "./project-punch-list-tab";
import type { TimeEntryWithEmployee, LaborLineRow } from "./project-finances-tab";
import type { ActivityItem } from "./project-activity-feed";
import type { Project, Customer, Estimate, QuoteRequest, ProjectTradeBudget, Invoice, ProjectFile as DBProjectFile, Walkthrough, Todo } from "@/types/database";

// ── Shared Types (exported for child tab components) ─────

export interface TeamMember {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
}

export interface ProjectMeeting {
  id: string;
  scheduled_at: string;
  status: string;
  address: string | null;
  city: string | null;
  summary: string | null;
}

export interface LinkedEmail {
  id: string;
  gmail_message_id: string;
  subject: string;
  from_name: string;
  from_email: string;
  to_name: string;
  to_email: string;
  date: string;
  direction: string;
  snippet: string;
  is_processed: boolean;
  attachments: { filename: string; mimeType: string; size: number; storage_path: string | null }[];
}

export interface ProjectFile {
  emailId: string;
  emailSubject: string;
  emailDate: string;
  filename: string;
  mimeType: string;
  size: number;
  storage_path: string | null;
}

export interface ConversationRef {
  email_id: string;
  message_count: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ProjectDetailTabsProps {
  project: Project;
  customer: Customer | null;
  linkedCustomers: Customer[];
  customers: Customer[];
  teamMembers: TeamMember[];
  pmName: string | null;
  estimatorName: string | null;
  estimates: Estimate[];
  activityItems: ActivityItem[];
  meetings: ProjectMeeting[];
  linkedEmails: LinkedEmail[];
  quoteRequests: QuoteRequest[];
  invoices: Invoice[];
  paymentsReceived: { id: string; project_id: string; payment_type: string; amount: number; received_date: string; method: string | null; reference_number: string | null; description: string | null; notes: string | null }[];
  changeOrders: { id: string; project_id: string; change_order_number: number; title: string; description: string | null; status: string; cost_impact: number; price_impact: number; approved_at: string | null; sent_to_client_at: string | null; client_viewed_at: string | null; client_view_count: number | null; client_signature: string | null; client_signed_at: string | null }[];
  clientInvoices: { id: string; project_id: string; invoice_number: number; title: string; description: string | null; line_items: { description: string; amount: number }[] | null; amount: number; terms: string | null; due_date: string | null; status: string; sent_to_client_at: string | null; client_viewed_at: string | null; client_view_count: number | null; paid_at: string | null; paid_amount: number | null; quickbooks_invoice_id: string | null; quickbooks_doc_number: string | null }[];
  budgetVsActual: { line_item_id: string; description: string; trade: string | null; budgeted_cost: number; budgeted_price: number; budgeted_profit: number; actual_invoiced: number; variance: number; percent_spent: number; is_section_header?: boolean | null }[];
  paymentMilestones?: { id: string; sort_order: number; label: string; stage_key: string; percent: number | null; amount: number | null; status: string; client_invoice_id: string | null }[];
  financials?: Record<string, number | string | null> | null;
  projectFiles: ProjectFile[];
  uploadedFiles: DBProjectFile[];
  dismissedFileKeys?: string[];
  fileOverrides?: Record<string, import("@/lib/actions/project-files").ProjectFileOverride>;
  conversations: ConversationRef[];
  timeEntries: TimeEntryWithEmployee[];
  laborByLine?: LaborLineRow[];
  /** True labor total (unmasked, labor_cost_source-aware) — see ProjectFinancesTab. */
  laborTotalCost?: number | null;
  schedulePhases: {
    id: string;
    name: string;
    description: string | null;
    start_date: string;
    end_date: string;
    planned_start_date: string | null;
    planned_end_date: string | null;
    status: string;
    color: string;
    event_type: string | null;
    notes: string | null;
    sort_order: number;
    estimate_line_item_id?: string | null;
    assigned_employee_ids?: string[];
    assigned_sub_ids?: string[];
    is_confirmed?: boolean;
    confirmed_with?: string | null;
  }[];
  estimateLineItems: { id: string; description: string; trade: string | null }[];
  employeeOptions: { id: string; first_name: string; last_name: string; title: string | null }[];
  dailyLogs: import("@/lib/actions/daily-logs").FeedDailyLog[];
  walkthroughs: Walkthrough[];
  punchList: Todo[];
  userId: string;
  canManageDocuments: boolean;
  tradeBudgets?: ProjectTradeBudget[];
  subDirectory?: SubDirectoryEntry[];
  /** Contract signing + lock state, resolved server-side (role check included). */
  contract?: ContractState;
}

// ── Main Component ───────────────────────────────────────────

export function ProjectDetailTabs({
  project,
  customer,
  linkedCustomers,
  customers,
  teamMembers,
  pmName,
  estimatorName,
  estimates,
  activityItems,
  meetings,
  linkedEmails,
  quoteRequests,
  invoices,
  paymentsReceived,
  changeOrders,
  clientInvoices,
  budgetVsActual,
  paymentMilestones = [],
  financials,
  projectFiles,
  uploadedFiles,
  dismissedFileKeys,
  fileOverrides,
  conversations,
  timeEntries,
  laborByLine,
  laborTotalCost,
  schedulePhases,
  estimateLineItems,
  employeeOptions,
  dailyLogs,
  walkthroughs,
  punchList,
  userId,
  canManageDocuments,
  tradeBudgets = [],
  subDirectory = [],
  contract,
}: ProjectDetailTabsProps) {
  const openPunchCount = punchList.filter((p) => p.status === "open").length;
  // Tabs push history entries so the browser/phone back gesture returns to
  // the previous tab instead of exiting the project entirely.
  const [rawActiveTab, setActiveTab] = useSearchParamState("tab", "overview", { history: "push" });
  // The Quotes tab became Subs — keep old ?tab=quotes links working.
  const activeTab = rawActiveTab === "quotes" ? "subs" : rawActiveTab;
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Full current URL (tab + returnUrl + filters) so links that leave the
  // project page can bring the user back to exactly where they were.
  const currentUrl = `${pathname}${searchParams.size > 0 ? `?${searchParams.toString()}` : ""}`;
  const [moreOpen, setMoreOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const primaryDocumentTab = canManageDocuments ? "files" : "emails";
  const primaryTabs = [
    { value: "overview", label: "Overview", icon: LayoutDashboard },
    { value: "schedule", label: "Schedule", icon: Calendar },
    { value: "finances", label: "Money", icon: DollarSign },
    {
      value: primaryDocumentTab,
      label: canManageDocuments ? "Files" : "Emails",
      icon: canManageDocuments ? FolderOpen : Mail,
    },
  ];
  const secondaryTabs = [
    { value: "emails", label: "Emails", count: linkedEmails.length, icon: Mail, show: primaryDocumentTab !== "emails" },
    { value: "subs", label: "Subs", count: quoteRequests.length, icon: HardHat, show: canManageDocuments },
    { value: "invoices", label: "Invoices", count: invoices.length, icon: Receipt, show: true },
    { value: "punch-list", label: "Punch List", count: openPunchCount, icon: ClipboardList, show: true },
    { value: "portal", label: "Client Portal", icon: Link2, show: true },
  ].filter((item) => item.show);
  const isSecondaryTab = secondaryTabs.some((item) => item.value === activeTab);
  const completedPhaseCount = schedulePhases.filter((phase) => phase.status === "completed").length;
  const scheduleProgress = schedulePhases.length > 0
    ? Math.round((completedPhaseCount / schedulePhases.length) * 100)
    : 0;
  const projectValue = Number(financials?.adjusted_contract)
    || Number(project.contract_value)
    || Number(project.estimated_value)
    || 0;
  const projectAddress = [project.address, project.city, project.state]
    .filter(Boolean)
    .join(", ");

  const openTab = (value: string) => {
    setActiveTab(value);
    setMoreOpen(false);
  };

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="min-w-0 space-y-4">
      <section className="rounded-2xl border bg-card p-4 shadow-sm md:hidden">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-500">
              {project.project_number}
            </p>
            <h2 className="truncate text-lg font-bold">{project.name}</h2>
          </div>
          <ProjectStatusBadge status={project.status} projectId={project.id} editable />
        </div>
        {projectAddress && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{projectAddress}</span>
          </div>
        )}
        {customer && (
          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <User className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              {customer.first_name} {customer.last_name}
            </span>
            {customer.phone && (
              <a
                href={`tel:${customer.phone}`}
                className="ml-auto shrink-0 font-medium text-amber-500"
              >
                Call
              </a>
            )}
          </div>
        )}
        <div className="mt-3 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            {schedulePhases.length > 0
              ? `${completedPhaseCount} of ${schedulePhases.length} phases`
              : "Schedule not started"}
          </span>
          <span className="font-semibold tabular-nums">
            {projectValue > 0
              ? new Intl.NumberFormat("en-US", {
                  style: "currency",
                  currency: "USD",
                  maximumFractionDigits: 0,
                }).format(projectValue)
              : "No contract value"}
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-amber-500 transition-all"
            style={{ width: `${scheduleProgress}%` }}
          />
        </div>
      </section>

      <div className="grid grid-cols-5 rounded-2xl border bg-card p-1 shadow-sm md:hidden">
        {primaryTabs.map((item) => {
          const Icon = item.icon;
          const selected = activeTab === item.value;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => openTab(item.value)}
              className={cn(
                "flex min-w-0 flex-col items-center gap-1 rounded-xl px-1 py-2 text-[10px] font-medium transition-colors",
                selected
                  ? "bg-amber-500/15 text-amber-500"
                  : "text-muted-foreground"
              )}
            >
              <Icon className="h-4.5 w-4.5" />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          className={cn(
            "flex min-w-0 flex-col items-center gap-1 rounded-xl px-1 py-2 text-[10px] font-medium transition-colors",
            isSecondaryTab
              ? "bg-amber-500/15 text-amber-500"
              : "text-muted-foreground"
          )}
        >
          <MoreHorizontal className="h-4.5 w-4.5" />
          <span>More</span>
        </button>
      </div>

      <BottomSheet open={moreOpen} onOpenChange={setMoreOpen}>
        <BottomSheetContent className="md:hidden" maxHeight="75vh">
          <BottomSheetHeader>
            <BottomSheetTitle>Project tools</BottomSheetTitle>
            <BottomSheetDescription>
              Everything for {project.name}
            </BottomSheetDescription>
          </BottomSheetHeader>
          <BottomSheetBody className="space-y-1 pb-6">
            {secondaryTabs.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => openTab(item.value)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors",
                    activeTab === item.value
                      ? "bg-amber-500/10 text-amber-500"
                      : "hover:bg-muted"
                  )}
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                    <Icon className="h-4.5 w-4.5" />
                  </span>
                  <span className="flex-1 text-sm font-medium">{item.label}</span>
                  {item.count != null && item.count > 0 && (
                    <Badge variant="secondary" className="tabular-nums">
                      {item.count}
                    </Badge>
                  )}
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              );
            })}
            <div className="my-2 border-t" />
            <Link
              href={`/projects/${project.id}/estimates?returnUrl=${encodeURIComponent(currentUrl)}`}
              onClick={() => setMoreOpen(false)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-muted"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                <Calculator className="h-4.5 w-4.5" />
              </span>
              <span className="flex-1 text-sm font-medium">Estimates</span>
              {estimates.length > 0 && (
                <Badge variant="secondary" className="tabular-nums">
                  {estimates.length}
                </Badge>
              )}
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
            <div className="my-2 border-t" />
            <button
              type="button"
              onClick={() => {
                setMoreOpen(false);
                setEditOpen(true);
              }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-muted"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                <Pencil className="h-4.5 w-4.5" />
              </span>
              <span className="flex-1 text-sm font-medium">Edit project</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
            <button
              type="button"
              onClick={() => {
                setMoreOpen(false);
                setDeleteOpen(true);
              }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-destructive transition-colors hover:bg-destructive/10"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-destructive/10">
                <Trash2 className="h-4.5 w-4.5" />
              </span>
              <span className="flex-1 text-sm font-medium">Delete project</span>
            </button>
          </BottomSheetBody>
        </BottomSheetContent>
      </BottomSheet>

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

      <TabsList className="hidden w-full justify-start overflow-x-auto flex-nowrap md:flex">
        <TabsTrigger value="overview" className="gap-1 text-xs sm:text-sm">
          <LayoutDashboard className="h-3.5 w-3.5" />
          Overview
        </TabsTrigger>
        <TabsTrigger value="emails" className="gap-1 text-xs sm:text-sm">
          <Mail className="h-3.5 w-3.5" />
          Emails
          {linkedEmails.length > 0 && (
            <Badge variant="secondary" className="text-[9px] h-4 px-1 ml-0.5">
              {linkedEmails.length}
            </Badge>
          )}
        </TabsTrigger>
        {canManageDocuments && (
          <TabsTrigger value="subs" className="gap-1 text-xs sm:text-sm">
            <HardHat className="h-3.5 w-3.5" />
            Subs
            {quoteRequests.length > 0 && (
              <Badge variant="secondary" className="text-[9px] h-4 px-1 ml-0.5">
                {quoteRequests.length}
              </Badge>
            )}
          </TabsTrigger>
        )}
        <TabsTrigger value="invoices" className="gap-1 text-xs sm:text-sm">
          <Receipt className="h-3.5 w-3.5" />
          Invoices
          {invoices.length > 0 && (
            <Badge variant="secondary" className="text-[9px] h-4 px-1 ml-0.5">
              {invoices.length}
            </Badge>
          )}
        </TabsTrigger>
        {canManageDocuments && (
          <TabsTrigger value="files" className="gap-1 text-xs sm:text-sm">
            <FolderOpen className="h-3.5 w-3.5" />
            Files
            {projectFiles.length + uploadedFiles.length > 0 && (
              <Badge variant="secondary" className="text-[9px] h-4 px-1 ml-0.5">
                {projectFiles.length + uploadedFiles.length}
              </Badge>
            )}
          </TabsTrigger>
        )}
        <TabsTrigger value="schedule" className="gap-1 text-xs sm:text-sm">
          <Calendar className="h-3.5 w-3.5" />
          Schedule
          {schedulePhases.length > 0 && (
            <Badge variant="secondary" className="text-[9px] h-4 px-1 ml-0.5">
              {schedulePhases.length}
            </Badge>
          )}
        </TabsTrigger>
        <TabsTrigger value="portal" className="gap-1 text-xs sm:text-sm">
          <Link2 className="h-3.5 w-3.5" />
          Portal
        </TabsTrigger>
        <TabsTrigger value="punch-list" className="gap-1 text-xs sm:text-sm">
          <ClipboardList className="h-3.5 w-3.5" />
          Punch List
          {openPunchCount > 0 && (
            <Badge variant="secondary" className="text-[9px] h-4 px-1 ml-0.5">
              {openPunchCount}
            </Badge>
          )}
        </TabsTrigger>
        <TabsTrigger value="finances" className="gap-1 text-xs sm:text-sm">
          <DollarSign className="h-3.5 w-3.5" />
          Finances
        </TabsTrigger>
      </TabsList>

      {/* ── Overview Tab ── */}
      <TabsContent value="overview">
        <ProjectDetail
          project={project}
          customer={customer}
          linkedCustomers={linkedCustomers}
          customers={customers}
          teamMembers={teamMembers}
          pmName={pmName}
          estimatorName={estimatorName}
          estimates={estimates}
          activityItems={activityItems}
          meetings={meetings}
          linkedEmails={linkedEmails}
          quoteRequests={quoteRequests}
          invoices={invoices}
          projectFiles={projectFiles}
          schedulePhaseCount={schedulePhases.length}
          completedPhaseCount={completedPhaseCount}
          punchListCount={openPunchCount}
          financials={financials as Parameters<typeof ProjectDetail>[0]["financials"]}
          walkthroughs={walkthroughs}
          onSwitchTab={setActiveTab}
          canManageDocuments={canManageDocuments}
        />
      </TabsContent>

      {/* ── Emails Tab ── */}
      <TabsContent value="emails">
        <ProjectEmailsTab
          emails={linkedEmails}
          conversations={conversations}
          projectName={project.name}
        />
      </TabsContent>

      {/* ── Subs Tab (awarding + sub management) ── */}
      {canManageDocuments && (
        <TabsContent value="subs">
          <ProjectSubsTab
            quotes={quoteRequests}
            projectId={project.id}
            projectName={project.name}
            projectAddress={projectAddress || null}
            linkedEmails={linkedEmails}
            budgetLines={budgetVsActual.map((b) => ({ trade: b.trade, budgeted_cost: b.budgeted_cost }))}
            tradeBudgets={tradeBudgets}
            subDirectory={subDirectory}
            invoices={invoices}
          />
        </TabsContent>
      )}

      {/* ── Invoices Tab ── */}
      <TabsContent value="invoices">
        <ProjectInvoicesTab
          invoices={invoices}
          projectId={project.id}
          projectName={project.name}
          changeOrders={changeOrders}
          budgetLines={budgetVsActual
            .filter((l) => !l.is_section_header)
            .map((l) => ({ id: l.line_item_id, description: l.description }))}
        />
      </TabsContent>

      {/* ── Files Tab ── */}
      {canManageDocuments && (
        <TabsContent value="files">
          <ProjectFilesTab files={projectFiles} quotes={quoteRequests} uploadedFiles={uploadedFiles} projectId={project.id} dismissedKeys={dismissedFileKeys} fileOverrides={fileOverrides} dailyLogs={dailyLogs} />
        </TabsContent>
      )}

      {/* ── Schedule Tab ── */}
      <TabsContent value="schedule">
        <ProjectScheduleTab
          projectId={project.id}
          projectName={project.name}
          projectDescription={project.description}
          projectType={project.project_type}
          projectAddress={project.address}
          phases={schedulePhases}
          lineItems={estimateLineItems}
          employees={employeeOptions}
          userId={userId}
        />
      </TabsContent>

      {/* ── Portal Tab ── */}
      <TabsContent value="portal">
        <ProjectPortalTab
          projectId={project.id}
          projectName={project.name}
          userId={userId}
          defaultClientName={customer ? `${customer.first_name} ${customer.last_name}`.trim() : ""}
          defaultClientEmail={customer?.email ?? ""}
        />
      </TabsContent>

      {/* ── Punch List Tab ── */}
      <TabsContent value="punch-list">
        <ProjectPunchListTab
          projectId={project.id}
          projectName={project.name}
          items={punchList}
          employees={employeeOptions}
        />
      </TabsContent>

      {/* ── Finances Tab (includes Change Orders) ── */}
      <TabsContent value="finances">
        <ProjectFinancesTab
          projectId={project.id}
          estimates={estimates}
          quoteRequests={quoteRequests}
          invoices={invoices}
          paymentsReceived={paymentsReceived}
          changeOrders={changeOrders}
          clientInvoices={clientInvoices}
          budgetVsActual={budgetVsActual}
          paymentMilestones={paymentMilestones}
          timeEntries={timeEntries}
          laborByLine={laborByLine}
          laborTotalCost={laborTotalCost}
          schedulePhases={schedulePhases}
          contractValue={project.contract_value ?? null}
          estimatedValue={project.estimated_value ?? null}
          contract={contract}
        />
      </TabsContent>
    </Tabs>
  );
}
