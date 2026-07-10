"use client";

import { useSearchParamState } from "@/lib/hooks/use-search-param-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  LayoutDashboard,
  Mail,
  DollarSign,
  Receipt,
  FolderOpen,
  ArrowLeft,
  Calendar,
  ClipboardList,
  Link2,
} from "lucide-react";
import { ProjectDetail } from "./project-detail";
import { ProjectEmailsTab } from "./project-emails-tab";
import { ProjectQuotesTab } from "./project-quotes-tab";
import { ProjectInvoicesTab } from "./project-invoices-tab";
import { ProjectFilesTab } from "./project-files-tab";
import { ProjectFinancesTab } from "./project-finances-tab";
import { ProjectScheduleTab } from "./project-schedule-tab";
import { ProjectPortalTab } from "./project-portal-tab";
import { ProjectPunchListTab } from "./project-punch-list-tab";
import type { TimeEntryWithEmployee } from "./project-finances-tab";
import type { ActivityItem } from "./project-activity-feed";
import type { Project, Customer, Estimate, QuoteRequest, Invoice, ProjectFile as DBProjectFile, Walkthrough, Todo } from "@/types/database";

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
  clientInvoices: { id: string; project_id: string; invoice_number: number; title: string; description: string | null; line_items: { description: string; amount: number }[] | null; amount: number; terms: string | null; due_date: string | null; status: string; sent_to_client_at: string | null; client_viewed_at: string | null; client_view_count: number | null; paid_at: string | null; paid_amount: number | null }[];
  budgetVsActual: { line_item_id: string; description: string; trade: string | null; budgeted_cost: number; budgeted_price: number; budgeted_profit: number; actual_invoiced: number; variance: number; percent_spent: number }[];
  financials?: Record<string, number | string | null> | null;
  projectFiles: ProjectFile[];
  uploadedFiles: DBProjectFile[];
  dismissedFileKeys?: string[];
  conversations: ConversationRef[];
  timeEntries: TimeEntryWithEmployee[];
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
    is_confirmed?: boolean;
    confirmed_with?: string | null;
  }[];
  estimateLineItems: { id: string; description: string; trade: string | null }[];
  employeeOptions: { id: string; first_name: string; last_name: string; title: string | null }[];
  dailyLogs: import("@/lib/actions/daily-logs").FeedDailyLog[];
  walkthroughs: Walkthrough[];
  punchList: Todo[];
  userId: string;
}

// ── Back to Overview button (shown on sub-tabs) ─────────────

function BackToOverview({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-3 -mt-1 transition-colors md:hidden"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to Overview
    </button>
  );
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
  financials,
  projectFiles,
  uploadedFiles,
  dismissedFileKeys,
  conversations,
  timeEntries,
  schedulePhases,
  estimateLineItems,
  employeeOptions,
  dailyLogs,
  walkthroughs,
  punchList,
  userId,
}: ProjectDetailTabsProps) {
  const openPunchCount = punchList.filter((p) => p.status === "open").length;
  const [activeTab, setActiveTab] = useSearchParamState("tab", "overview");

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
      <div className="md:hidden">
        <label
          htmlFor="project-section"
          className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Project section
        </label>
        <select
          id="project-section"
          value={activeTab}
          onChange={(event) => setActiveTab(event.target.value)}
          className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm font-medium shadow-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
        >
          <option value="overview">Overview</option>
          <option value="emails">Emails ({linkedEmails.length})</option>
          <option value="quotes">Quotes ({quoteRequests.length})</option>
          <option value="invoices">Invoices ({invoices.length})</option>
          <option value="files">Files ({projectFiles.length})</option>
          <option value="schedule">Schedule ({schedulePhases.length})</option>
          <option value="portal">Client Portal</option>
          <option value="punch-list">Punch List ({openPunchCount})</option>
          <option value="finances">Finances</option>
        </select>
      </div>

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
        <TabsTrigger value="quotes" className="gap-1 text-xs sm:text-sm">
          <DollarSign className="h-3.5 w-3.5" />
          Quotes
          {quoteRequests.length > 0 && (
            <Badge variant="secondary" className="text-[9px] h-4 px-1 ml-0.5">
              {quoteRequests.length}
            </Badge>
          )}
        </TabsTrigger>
        <TabsTrigger value="invoices" className="gap-1 text-xs sm:text-sm">
          <Receipt className="h-3.5 w-3.5" />
          Invoices
          {invoices.length > 0 && (
            <Badge variant="secondary" className="text-[9px] h-4 px-1 ml-0.5">
              {invoices.length}
            </Badge>
          )}
        </TabsTrigger>
        <TabsTrigger value="files" className="gap-1 text-xs sm:text-sm">
          <FolderOpen className="h-3.5 w-3.5" />
          Files
          {projectFiles.length > 0 && (
            <Badge variant="secondary" className="text-[9px] h-4 px-1 ml-0.5">
              {projectFiles.length}
            </Badge>
          )}
        </TabsTrigger>
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
          completedPhaseCount={schedulePhases.filter((p) => p.status === "completed").length}
          punchListCount={openPunchCount}
          financials={financials as Parameters<typeof ProjectDetail>[0]["financials"]}
          walkthroughs={walkthroughs}
          onSwitchTab={setActiveTab}
        />
      </TabsContent>

      {/* ── Emails Tab ── */}
      <TabsContent value="emails">
        <BackToOverview onClick={() => setActiveTab("overview")} />
        <ProjectEmailsTab
          emails={linkedEmails}
          conversations={conversations}
          projectName={project.name}
          projectId={project.id}
        />
      </TabsContent>

      {/* ── Quotes Tab ── */}
      <TabsContent value="quotes">
        <BackToOverview onClick={() => setActiveTab("overview")} />
        <ProjectQuotesTab
          quotes={quoteRequests}
          projectId={project.id}
          projectName={project.name}
          linkedEmails={linkedEmails}
        />
      </TabsContent>

      {/* ── Invoices Tab ── */}
      <TabsContent value="invoices">
        <BackToOverview onClick={() => setActiveTab("overview")} />
        <ProjectInvoicesTab invoices={invoices} projectId={project.id} projectName={project.name} changeOrders={changeOrders} />
      </TabsContent>

      {/* ── Files Tab ── */}
      <TabsContent value="files">
        <BackToOverview onClick={() => setActiveTab("overview")} />
        <ProjectFilesTab files={projectFiles} quotes={quoteRequests} uploadedFiles={uploadedFiles} projectId={project.id} dismissedKeys={dismissedFileKeys} dailyLogs={dailyLogs} />
      </TabsContent>

      {/* ── Schedule Tab ── */}
      <TabsContent value="schedule">
        <BackToOverview onClick={() => setActiveTab("overview")} />
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
        <BackToOverview onClick={() => setActiveTab("overview")} />
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
        <BackToOverview onClick={() => setActiveTab("overview")} />
        <ProjectPunchListTab
          projectId={project.id}
          projectName={project.name}
          items={punchList}
          employees={employeeOptions}
        />
      </TabsContent>

      {/* ── Finances Tab (includes Change Orders) ── */}
      <TabsContent value="finances">
        <BackToOverview onClick={() => setActiveTab("overview")} />
        <ProjectFinancesTab
          projectId={project.id}
          estimates={estimates}
          quoteRequests={quoteRequests}
          invoices={invoices}
          paymentsReceived={paymentsReceived}
          changeOrders={changeOrders}
          clientInvoices={clientInvoices}
          budgetVsActual={budgetVsActual}
          timeEntries={timeEntries}
          schedulePhases={schedulePhases}
          contractValue={project.contract_value ?? null}
          estimatedValue={project.estimated_value ?? null}
        />
      </TabsContent>
    </Tabs>
  );
}
