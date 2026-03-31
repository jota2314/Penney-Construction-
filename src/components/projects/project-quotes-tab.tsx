"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DollarSign,
  FileText,
  Loader2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { QuoteRequest } from "@/types/database";
import type { LinkedEmail } from "@/components/projects/project-detail-tabs";

interface ProjectQuotesTabProps {
  quotes: QuoteRequest[];
  projectName: string;
  linkedEmails: LinkedEmail[];
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  received: { label: "Received", color: "bg-green-500/15 text-green-500 border-green-500/30" },
  awaiting_reply: { label: "Awaiting Reply", color: "bg-amber-500/15 text-amber-500 border-amber-500/30" },
  just_sent: { label: "Sent", color: "bg-blue-500/15 text-blue-500 border-blue-500/30" },
  accepted: { label: "Accepted", color: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30" },
  declined: { label: "Declined", color: "bg-red-500/15 text-red-500 border-red-500/30" },
  in_progress: { label: "In Progress", color: "bg-purple-500/15 text-purple-500 border-purple-500/30" },
};

export function ProjectQuotesTab({ quotes, projectName, linkedEmails }: ProjectQuotesTabProps) {
  const [loadingQuoteId, setLoadingQuoteId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const totalQuoted = quotes.reduce((sum, q) => sum + (Number(q.amount) || 0), 0);
  const receivedCount = quotes.filter(q => q.status === "received" || q.status === "accepted").length;

  function findAttachmentPath(q: QuoteRequest): string | null {
    if (q.attachment_storage_path) {
      // If the path has no slash, it's just a filename — prepend gmail_message_id
      if (!q.attachment_storage_path.includes("/") && q.gmail_message_id) {
        // Try to find the actual storage_path from the email's attachments
        const email = linkedEmails.find(e => e.gmail_message_id === q.gmail_message_id);
        if (email?.attachments) {
          const att = (email.attachments as { filename?: string; storage_path?: string | null }[]).find(
            a => a.storage_path && (a.filename === q.attachment_storage_path || a.storage_path?.endsWith(q.attachment_storage_path!))
          );
          if (att?.storage_path) return att.storage_path;
        }
        // Fallback: construct path from gmail_message_id + sanitized filename
        const safeName = q.attachment_storage_path.replace(/[^a-zA-Z0-9._-]/g, "_");
        return `${q.gmail_message_id}/${safeName}`;
      }
      return q.attachment_storage_path;
    }
    if (q.gmail_message_id) {
      const email = linkedEmails.find(e => e.gmail_message_id === q.gmail_message_id);
      if (email?.attachments) {
        const att = (email.attachments as { filename?: string; storage_path?: string | null }[]).find(
          a => a.storage_path && a.filename?.toLowerCase().endsWith(".pdf")
        ) || (email.attachments as { storage_path?: string | null }[]).find(a => a.storage_path);
        if (att?.storage_path) return att.storage_path;
      }
    }
    const subLower = q.subcontractor_name.toLowerCase();
    for (const email of linkedEmails) {
      if (!email.attachments) continue;
      const text = `${email.subject} ${email.from_name} ${email.from_email}`.toLowerCase();
      if (!text.includes(subLower) && !subLower.split(" ").some(w => w.length > 3 && text.includes(w))) continue;
      const att = (email.attachments as { filename?: string; storage_path?: string | null }[]).find(
        a => a.storage_path && a.filename?.toLowerCase().endsWith(".pdf")
      );
      if (att?.storage_path) return att.storage_path;
    }
    return null;
  }

  async function handleViewPdf(q: QuoteRequest) {
    const path = findAttachmentPath(q);
    if (!path) return;
    const newTab = window.open("about:blank", "_blank");
    setLoadingQuoteId(q.id);
    try {
      const supabase = createClient();
      const { data } = await supabase.storage
        .from("email-attachments")
        .createSignedUrl(path, 3600);
      if (data?.signedUrl && newTab) newTab.location.href = data.signedUrl;
      else if (data?.signedUrl) window.location.href = data.signedUrl;
    } finally {
      setLoadingQuoteId(null);
    }
  }

  if (quotes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <DollarSign className="h-12 w-12 text-muted-foreground/30 mb-3" />
        <h3 className="font-medium text-muted-foreground">No quotes for {projectName}</h3>
        <p className="text-sm text-muted-foreground/70 mt-1 max-w-sm">
          Quotes will appear here when the AI identifies them during email triage.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border bg-card p-3">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Total Quoted</div>
          <div className="text-lg font-bold text-foreground mt-0.5">{formatCurrency(totalQuoted)}</div>
        </div>
        <div className="rounded-xl border bg-card p-3">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Quotes</div>
          <div className="text-lg font-bold text-foreground mt-0.5">{quotes.length}</div>
        </div>
        <div className="rounded-xl border bg-card p-3">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Received</div>
          <div className="text-lg font-bold text-green-500 mt-0.5">{receivedCount}</div>
        </div>
      </div>

      {/* Quote List */}
      <div className="space-y-2">
        {quotes.map((q) => {
          const isExpanded = expandedId === q.id;
          const hasFile = !!findAttachmentPath(q);
          const isLoading = loadingQuoteId === q.id;
          const config = STATUS_CONFIG[q.status] || { label: q.status, color: "bg-muted text-foreground" };

          return (
            <div key={q.id} className="rounded-xl border bg-card overflow-hidden">
              {/* Header Row */}
              <button
                onClick={() => setExpandedId(isExpanded ? null : q.id)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
              >
                <div className="h-10 w-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
                  <DollarSign className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{q.subcontractor_name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {q.trade && <span className="capitalize">{q.trade} · </span>}
                    {q.sent_at && <span>{formatDate(q.sent_at)}</span>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  {q.amount != null && (
                    <div className="text-sm font-semibold text-green-500">{formatCurrency(Number(q.amount))}</div>
                  )}
                  <Badge variant="outline" className={`text-[9px] ${config.color}`}>
                    {config.label}
                  </Badge>
                </div>
                {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
              </button>

              {/* Expanded Detail */}
              {isExpanded && (
                <div className="px-4 pb-4 pt-1 border-t space-y-3">
                  {/* Details Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">Subcontractor:</span>{" "}
                      <span className="font-medium">{q.subcontractor_name}</span>
                    </div>
                    {q.trade && (
                      <div>
                        <span className="text-muted-foreground">Trade:</span>{" "}
                        <span className="capitalize">{q.trade}</span>
                      </div>
                    )}
                    {q.document_type && q.document_type !== "quote" && (
                      <div>
                        <span className="text-muted-foreground">Type:</span>{" "}
                        <span className="capitalize">{q.document_type.replace(/_/g, " ")}</span>
                      </div>
                    )}
                    {q.sent_at && (
                      <div>
                        <span className="text-muted-foreground">Date:</span>{" "}
                        {formatDate(q.sent_at)}
                      </div>
                    )}
                  </div>

                  {/* Scope */}
                  {q.scope_description && (
                    <div className="text-xs">
                      <span className="text-muted-foreground">Scope:</span>{" "}
                      {q.scope_description}
                    </div>
                  )}

                  {/* Extracted Text */}
                  {q.extracted_text && (
                    <div className="rounded-lg bg-muted/50 p-3 text-xs max-h-40 overflow-y-auto whitespace-pre-wrap font-mono">
                      {q.extracted_text}
                    </div>
                  )}

                  {/* Notes */}
                  {q.notes && (
                    <div className="text-xs">
                      <span className="text-muted-foreground">Notes:</span> {q.notes}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-1">
                    {hasFile && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => handleViewPdf(q)}
                        disabled={isLoading}
                      >
                        {isLoading ? (
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        ) : (
                          <ExternalLink className="h-3 w-3 mr-1" />
                        )}
                        View PDF
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
