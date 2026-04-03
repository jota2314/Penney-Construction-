"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  LayoutDashboard,
  Mail,
  DollarSign,
  Receipt,
  FolderOpen,
  Bot,
  ArrowLeft,
} from "lucide-react";
import { ProjectDetail } from "./project-detail";
import { ProjectEmailsTab } from "./project-emails-tab";
import { ProjectQuotesTab } from "./project-quotes-tab";
import { ProjectInvoicesTab } from "./project-invoices-tab";
import { ProjectFilesTab } from "./project-files-tab";
import { ProjectChatTab } from "./project-chat-tab";
import { ProjectFinancesTab } from "./project-finances-tab";
import type { TimeEntryWithEmployee } from "./project-finances-tab";
import type { ActivityItem } from "./project-activity-feed";
import type { Project, Customer, Estimate, QuoteRequest, Invoice, ProjectFile as DBProjectFile } from "@/types/database";

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
  projectFiles: ProjectFile[];
  uploadedFiles: DBProjectFile[];
  conversations: ConversationRef[];
  timeEntries: TimeEntryWithEmployee[];
}

// ── Back to Overview button (shown on sub-tabs) ─────────────

function BackToOverview({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-3 -mt-1 transition-colors"
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
  projectFiles,
  uploadedFiles,
  conversations,
  timeEntries,
}: ProjectDetailTabsProps) {
  const [activeTab, setActiveTab] = useState("overview");

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
      <TabsList className="w-full justify-start overflow-x-auto flex-nowrap">
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
        <TabsTrigger value="finances" className="gap-1 text-xs sm:text-sm">
          <DollarSign className="h-3.5 w-3.5" />
          Finances
        </TabsTrigger>
        <TabsTrigger value="ai" className="gap-1 text-xs sm:text-sm">
          <Bot className="h-3.5 w-3.5 text-amber-500" />
          AI
        </TabsTrigger>
      </TabsList>

      {/* ── Overview Tab ── */}
      <TabsContent value="overview">
        <ProjectDetail
          project={project}
          customer={customer}
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
          projectName={project.name}
          linkedEmails={linkedEmails}
        />
      </TabsContent>

      {/* ── Invoices Tab ── */}
      <TabsContent value="invoices">
        <BackToOverview onClick={() => setActiveTab("overview")} />
        <ProjectInvoicesTab invoices={invoices} projectName={project.name} />
      </TabsContent>

      {/* ── Files Tab ── */}
      <TabsContent value="files">
        <BackToOverview onClick={() => setActiveTab("overview")} />
        <ProjectFilesTab files={projectFiles} quotes={quoteRequests} uploadedFiles={uploadedFiles} projectId={project.id} />
      </TabsContent>

      {/* ── Finances Tab ── */}
      <TabsContent value="finances">
        <BackToOverview onClick={() => setActiveTab("overview")} />
        <ProjectFinancesTab
          estimates={estimates}
          quoteRequests={quoteRequests}
          invoices={invoices}
          timeEntries={timeEntries}
          contractValue={project.contract_value ?? null}
          estimatedValue={project.estimated_value ?? null}
        />
      </TabsContent>

      {/* ── AI Chat Tab ── */}
      <TabsContent value="ai">
        <BackToOverview onClick={() => setActiveTab("overview")} />
        <ProjectChatTab
          project={project}
          customer={customer}
          linkedEmails={linkedEmails}
          quoteRequests={quoteRequests}
          estimates={estimates}
        />
      </TabsContent>
    </Tabs>
  );
}
