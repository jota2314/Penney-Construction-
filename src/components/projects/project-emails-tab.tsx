"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
  Mail,
  ArrowDownLeft,
  ArrowUpRight,
  Paperclip,
  CheckCircle,
  MessageSquare,
} from "lucide-react";
import type { LinkedEmail, ConversationRef } from "@/components/projects/project-detail-tabs";

interface ProjectEmailsTabProps {
  emails: LinkedEmail[];
  conversations: ConversationRef[];
  projectName: string;
}

export function ProjectEmailsTab({
  emails,
  conversations,
  projectName,
}: ProjectEmailsTabProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const convoMap = new Map(conversations.map((c) => [c.email_id, c.message_count]));
  // Current URL (tab + any original returnUrl/filters) so the email detail
  // page's back arrow returns to exactly this view.
  const returnUrl = encodeURIComponent(
    `${pathname}${searchParams.size > 0 ? `?${searchParams.toString()}` : `?tab=emails`}`
  );

  if (emails.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Mail className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p className="font-medium">No emails linked to {projectName}</p>
        <p className="text-sm mt-1">Emails get linked when the AI processes them and matches them to this project</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Email History
        </h3>
        <Badge variant="secondary" className="text-xs">
          {emails.length} email{emails.length !== 1 ? "s" : ""}
        </Badge>
      </div>

      <div className="border rounded-lg divide-y overflow-hidden">
        {emails.map((email) => {
          const msgCount = convoMap.get(email.id) ?? 0;
          return (
            <button
              key={email.id}
              onClick={() => router.push(`/command-center/email/${email.id}?returnUrl=${returnUrl}`)}
              className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors flex items-start gap-3"
            >
              <div className={`p-1.5 rounded shrink-0 mt-0.5 ${
                email.direction === "inbound" ? "bg-blue-500/20" : "bg-green-500/20"
              }`}>
                {email.direction === "inbound"
                  ? <ArrowDownLeft className="h-3.5 w-3.5 text-blue-400" />
                  : <ArrowUpRight className="h-3.5 w-3.5 text-green-400" />}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium truncate">{email.subject || "(no subject)"}</p>
                  {email.is_processed && <CheckCircle className="h-3 w-3 text-green-500 shrink-0" />}
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {email.direction === "inbound"
                    ? email.from_name || email.from_email
                    : `To: ${email.to_name || email.to_email}`}
                </p>
                <p className="text-xs text-muted-foreground/60 truncate mt-0.5">{email.snippet}</p>
              </div>

              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className="text-[10px] text-muted-foreground">
                  {new Date(email.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
                <div className="flex gap-1">
                  {email.attachments?.length > 0 && (
                    <Badge variant="outline" className="text-[9px] gap-0.5 px-1">
                      <Paperclip className="h-2.5 w-2.5" />
                      {email.attachments.length}
                    </Badge>
                  )}
                  {msgCount > 0 && (
                    <Badge variant="outline" className="text-[9px] gap-0.5 px-1 border-amber-500/30 text-amber-500">
                      <MessageSquare className="h-2.5 w-2.5" />
                      {msgCount}
                    </Badge>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
