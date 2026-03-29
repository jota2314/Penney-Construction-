"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DollarSign,
  FileText,
  Loader2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { QuoteRequest } from "@/types/database";
import type { LinkedEmail } from "@/components/projects/project-detail-tabs";

const fmt = (val: number | null) =>
  val != null
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(val)
    : "—";

interface ProjectQuotesTabProps {
  quotes: QuoteRequest[];
  projectName: string;
  linkedEmails: LinkedEmail[];
}

export function ProjectQuotesTab({
  quotes,
  projectName,
  linkedEmails,
}: ProjectQuotesTabProps) {
  const [loadingQuoteId, setLoadingQuoteId] = useState<string | null>(null);
  const [expandedQuoteId, setExpandedQuoteId] = useState<string | null>(null);

  // Build a list of all PDF attachments from the project's linked emails
  function findAttachmentFromEmails(q: QuoteRequest): string | null {
    // 1. Direct attachment_storage_path
    if (q.attachment_storage_path) return q.attachment_storage_path;

    // 2. Look in the email that created this quote
    if (q.gmail_message_id) {
      const email = linkedEmails.find((e) => e.gmail_message_id === q.gmail_message_id);
      if (email?.attachments && Array.isArray(email.attachments)) {
        const att = (email.attachments as { filename?: string; storage_path?: string }[]).find(
          (a) => a.storage_path && a.filename?.toLowerCase().endsWith(".pdf")
        ) || (email.attachments as { storage_path?: string }[]).find((a) => a.storage_path);
        if (att?.storage_path) return att.storage_path;
      }
    }

    // 3. Search ALL linked emails for attachments matching the sub name
    const subLower = q.subcontractor_name.toLowerCase();
    for (const email of linkedEmails) {
      if (!email.attachments || !Array.isArray(email.attachments)) continue;
      // Check if email subject/from mentions the subcontractor
      const emailText = `${email.subject} ${email.from_name} ${email.from_email}`.toLowerCase();
      if (!emailText.includes(subLower) && !subLower.split(" ").some((w) => w.length > 3 && emailText.includes(w))) continue;
      const att = (email.attachments as { filename?: string; storage_path?: string }[]).find(
        (a) => a.storage_path && a.filename?.toLowerCase().endsWith(".pdf")
      ) || (email.attachments as { storage_path?: string }[]).find((a) => a.storage_path);
      if (att?.storage_path) return att.storage_path;
    }

    return null;
  }

  async function handleOpenQuote(q: QuoteRequest) {
    const storagePath = findAttachmentFromEmails(q);
    if (!storagePath) return;
    // Open window SYNCHRONOUSLY (before async) so Safari doesn't block it as a popup
    const newTab = window.open("about:blank", "_blank");
    setLoadingQuoteId(q.id);
    try {
      const supabase = createClient();
      const { data } = await supabase.storage
        .from("email-attachments")
        .createSignedUrl(storagePath, 3600);
      if (data?.signedUrl && newTab) {
        newTab.location.href = data.signedUrl;
      } else if (data?.signedUrl) {
        // Fallback if popup was still blocked — navigate in same tab
        window.location.href = data.signedUrl;
      }
    } finally {
      setLoadingQuoteId(null);
    }
  }

  if (quotes.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <DollarSign className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p className="font-medium">No quotes for {projectName}</p>
        <p className="text-sm mt-1">Sub quotes get created when the AI processes emails with pricing</p>
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    received: "bg-green-500/20 text-green-400",
    awaiting_reply: "bg-amber-500/20 text-amber-400",
    just_sent: "bg-blue-500/20 text-blue-400",
    accepted: "bg-emerald-500/20 text-emerald-400",
    declined: "bg-red-500/20 text-red-400",
    in_progress: "bg-purple-500/20 text-purple-400",
  };

  const docTypeLabels: Record<string, string> = {
    quote: "Quote",
    invoice: "Invoice",
    change_order: "Change Order",
    estimate: "Estimate",
    permit: "Permit",
    contract: "Contract",
    other: "Document",
  };

  const docTypeColors: Record<string, string> = {
    quote: "bg-blue-500/20 text-blue-400",
    invoice: "bg-amber-500/20 text-amber-400",
    change_order: "bg-purple-500/20 text-purple-400",
    estimate: "bg-emerald-500/20 text-emerald-400",
    permit: "bg-orange-500/20 text-orange-400",
    contract: "bg-teal-500/20 text-teal-400",
    other: "bg-muted text-foreground",
  };

  // Group quotes by document type
  const grouped = new Map<string, QuoteRequest[]>();
  for (const q of quotes) {
    const docType = q.document_type || "quote";
    if (!grouped.has(docType)) grouped.set(docType, []);
    grouped.get(docType)!.push(q);
  }

  // Sort groups: quote first, then invoice, then others alphabetically
  const groupOrder = ["quote", "invoice", "change_order", "estimate", "permit", "contract", "other"];
  const sortedGroups = [...grouped.entries()].sort(
    (a, b) => (groupOrder.indexOf(a[0]) === -1 ? 99 : groupOrder.indexOf(a[0])) - (groupOrder.indexOf(b[0]) === -1 ? 99 : groupOrder.indexOf(b[0]))
  );

  return (
    <div className="space-y-4">
      {sortedGroups.map(([docType, groupQuotes]) => (
        <div key={docType} className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              {docTypeLabels[docType] || docType}s
            </h3>
            <Badge variant="secondary" className="text-[9px]">
              {groupQuotes.length}
            </Badge>
          </div>

          <div className="space-y-2">
            {groupQuotes.map((q) => {
              const hasFile = !!findAttachmentFromEmails(q);
              const isLoading = loadingQuoteId === q.id;
              const isExpanded = expandedQuoteId === q.id;

              return (
                <div key={q.id} className="border rounded-lg bg-card overflow-hidden">
                  {/* Summary row — always visible, tap to expand */}
                  <button
                    type="button"
                    className="w-full text-left p-4 hover:bg-card/80 transition-colors"
                    onClick={() => setExpandedQuoteId(isExpanded ? null : q.id)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{q.subcontractor_name}</p>
                        {q.trade && (
                          <p className="text-xs text-muted-foreground capitalize">{q.trade}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {q.amount != null && (
                          <span className="text-sm font-bold text-green-500">{fmt(q.amount)}</span>
                        )}
                        <Badge className={`text-[10px] ${statusColors[q.status] ?? "bg-muted text-foreground"}`}>
                          {q.status.replace(/_/g, " ")}
                        </Badge>
                      </div>
                    </div>
                    {!isExpanded && q.scope_description && (
                      <p className="text-xs text-muted-foreground line-clamp-1 mt-1">{q.scope_description}</p>
                    )}
                  </button>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="border-t px-4 pb-4 pt-3 space-y-3">
                      {/* Amount (prominent) */}
                      {q.amount != null && (
                        <div className="flex items-center gap-2 py-2 px-3 bg-green-500/10 rounded-lg">
                          <DollarSign className="h-5 w-5 text-green-500" />
                          <span className="text-2xl font-bold text-green-500">{fmt(q.amount)}</span>
                        </div>
                      )}

                      {/* Info grid */}
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <p className="text-muted-foreground/60 mb-0.5">Subcontractor</p>
                          <p className="font-medium">{q.subcontractor_name}</p>
                        </div>
                        {q.trade && (
                          <div>
                            <p className="text-muted-foreground/60 mb-0.5">Trade</p>
                            <p className="font-medium capitalize">{q.trade}</p>
                          </div>
                        )}
                        <div>
                          <p className="text-muted-foreground/60 mb-0.5">Status</p>
                          <Badge className={`text-[10px] ${statusColors[q.status] ?? "bg-muted text-foreground"}`}>
                            {q.status.replace(/_/g, " ")}
                          </Badge>
                        </div>
                        <div>
                          <p className="text-muted-foreground/60 mb-0.5">Date</p>
                          <p>{new Date(q.sent_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
                        </div>
                      </div>

                      {/* Scope */}
                      {q.scope_description && (
                        <div>
                          <p className="text-xs text-muted-foreground/60 mb-1">Scope</p>
                          <p className="text-sm text-muted-foreground">{q.scope_description}</p>
                        </div>
                      )}

                      {/* Extracted text from PDF */}
                      {q.extracted_text && (
                        <div>
                          <p className="text-xs text-muted-foreground/60 mb-1">Extracted from PDF</p>
                          <div className="bg-muted/30 rounded-lg p-3 text-xs text-muted-foreground whitespace-pre-wrap max-h-48 overflow-auto">
                            {q.extracted_text}
                          </div>
                        </div>
                      )}

                      {/* Notes */}
                      {q.notes && (
                        <div>
                          <p className="text-xs text-muted-foreground/60 mb-1">Notes</p>
                          <p className="text-xs text-muted-foreground italic">{q.notes}</p>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex gap-2 pt-1">
                        {hasFile && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs gap-1.5"
                            onClick={() => handleOpenQuote(q)}
                            disabled={isLoading}
                          >
                            {isLoading ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <FileText className="h-3.5 w-3.5" />
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
      ))}

    </div>
  );
}
