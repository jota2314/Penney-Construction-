"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Mail,
  AlertCircle,
  FileText,
  ChevronDown,
  ChevronUp,
  Clock,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { updateFollowUpStatus } from "@/lib/actions/command-center";
import { useRouter } from "next/navigation";

interface ActionInboxProps {
  followUps: Array<{
    id: string;
    contact_name: string;
    contact_type: string;
    description: string;
    priority: string;
    project_name: string | null;
    project_id: string | null;
    due_date: string | null;
    type: "follow_up";
    isOverdue: boolean;
  }>;
  quotes: Array<{
    id: string;
    subcontractor_name: string;
    project_name: string | null;
    project_id: string | null;
    trade: string | null;
    amount: number | null;
    status: string;
    type: "quote_review";
  }>;
  emails: Array<{
    id: string;
    subject: string;
    from_name: string | null;
    from_email: string | null;
    project_name: string | null;
    project_id: string | null;
    category: string | null;
    sent_at: string | null;
    type: "email";
  }>;
  onOpenChat: (context: { projectId?: string; projectName?: string; message?: string }) => void;
}

const priorityColors: Record<string, string> = {
  urgent: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  low: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
};

export function ActionInbox({ followUps, quotes, emails, onOpenChat }: ActionInboxProps) {
  const [expanded, setExpanded] = useState(true);
  const router = useRouter();

  const totalItems = followUps.length + quotes.length + emails.length;
  const overdueCount = followUps.filter((f) => f.isOverdue).length;

  const handleMarkDone = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await updateFollowUpStatus(id, "done");
    router.refresh();
  };

  return (
    <div className="rounded-lg border bg-card">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between p-4 text-left hover:bg-accent/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-amber-500" />
          <h3 className="font-semibold text-base">Action Inbox</h3>
          <Badge variant="secondary" className="text-xs">
            {totalItems}
          </Badge>
          {overdueCount > 0 && (
            <Badge variant="destructive" className="text-xs">
              {overdueCount} overdue
            </Badge>
          )}
        </div>
        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {expanded && (
        <div className="border-t divide-y">
          {totalItems === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              All clear! No pending actions.
            </div>
          )}

          {/* Follow-ups */}
          {followUps.map((item) => (
            <div
              key={`fu-${item.id}`}
              onClick={() =>
                onOpenChat({
                  projectId: item.project_id || undefined,
                  projectName: item.project_name || undefined,
                  message: `Help me follow up: ${item.description} (contact: ${item.contact_name})`,
                })
              }
              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-accent/50 transition-colors"
            >
              <Clock className={cn("h-4 w-4 shrink-0", item.isOverdue ? "text-red-500" : "text-amber-500")} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{item.description}</p>
                <p className="text-xs text-muted-foreground">
                  {item.contact_name}
                  {item.project_name && ` \u00b7 ${item.project_name}`}
                  {item.due_date && ` \u00b7 Due ${new Date(item.due_date).toLocaleDateString()}`}
                </p>
              </div>
              <Badge className={cn("text-[10px] shrink-0", priorityColors[item.priority])}>
                {item.priority}
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={(e) => handleMarkDone(item.id, e)}
                title="Mark done"
              >
                <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground hover:text-green-600" />
              </Button>
            </div>
          ))}

          {/* Quotes to review */}
          {quotes.map((item) => (
            <div
              key={`q-${item.id}`}
              onClick={() =>
                onOpenChat({
                  projectId: item.project_id || undefined,
                  projectName: item.project_name || undefined,
                  message: `Review the quote from ${item.subcontractor_name} for ${item.trade || "work"} on ${item.project_name || "project"}: $${item.amount?.toLocaleString() || "amount pending"}`,
                })
              }
              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-accent/50 transition-colors"
            >
              <FileText className="h-4 w-4 shrink-0 text-blue-500" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  Quote from {item.subcontractor_name}
                  {item.amount ? ` \u2014 $${item.amount.toLocaleString()}` : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  {item.trade || "General"}
                  {item.project_name && ` \u00b7 ${item.project_name}`}
                </p>
              </div>
              <Badge className="text-[10px] bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 shrink-0">
                Review
              </Badge>
            </div>
          ))}

          {/* Recent emails */}
          {emails.map((item) => (
            <div
              key={`e-${item.id}`}
              onClick={() =>
                onOpenChat({
                  projectId: item.project_id || undefined,
                  projectName: item.project_name || undefined,
                  message: `Help me respond to this email from ${item.from_name || item.from_email}: "${item.subject}"`,
                })
              }
              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-accent/50 transition-colors"
            >
              <Mail className="h-4 w-4 shrink-0 text-purple-500" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{item.subject}</p>
                <p className="text-xs text-muted-foreground">
                  {item.from_name || item.from_email}
                  {item.project_name && ` \u00b7 ${item.project_name}`}
                </p>
              </div>
              <span className="text-[10px] text-muted-foreground shrink-0">
                {item.sent_at
                  ? new Date(item.sent_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                  : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
