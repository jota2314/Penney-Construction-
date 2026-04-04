"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DollarSign,
  FileText,
  Loader2,
  ChevronDown,
  ChevronUp,
  Eye,
  Pencil,
  Check,
  X,
  CheckCircle,
  ShieldCheck,
  ScanSearch,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/utils";
import { PdfViewer } from "@/components/ui/pdf-viewer";
import type { QuoteRequest, QuoteRequestStatus } from "@/types/database";
import type { LinkedEmail } from "@/components/projects/project-detail-tabs";
import { QuoteSplitDialog } from "./quote-split-dialog";
import { QuoteScanDialog } from "./quote-scan-dialog";
import { QuoteCoverageView } from "@/components/estimates/quote-coverage-view";

interface ProjectQuotesTabProps {
  quotes: QuoteRequest[];
  projectId: string;
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
  approved: { label: "Approved (Bill)", color: "bg-cyan-500/15 text-cyan-500 border-cyan-500/30" },
};

const ALL_STATUSES: { value: QuoteRequestStatus; label: string }[] = [
  { value: "just_sent", label: "Sent" },
  { value: "awaiting_reply", label: "Awaiting Reply" },
  { value: "received", label: "Received" },
  { value: "in_progress", label: "In Progress" },
  { value: "accepted", label: "Accepted" },
  { value: "approved", label: "Approved (Bill)" },
  { value: "declined", label: "Declined" },
];

export function ProjectQuotesTab({ quotes: initialQuotes, projectId, projectName, linkedEmails }: ProjectQuotesTabProps) {
  const [quotes, setQuotes] = useState(initialQuotes);
  const [loadingQuoteId, setLoadingQuoteId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [splitQuoteId, setSplitQuoteId] = useState<string | null>(null);
  const [scanQuoteId, setScanQuoteId] = useState<string | null>(null);
  const [previewFilename, setPreviewFilename] = useState("");
  const [saving, setSaving] = useState(false);

  // Edit form state
  const [editAmount, setEditAmount] = useState("");
  const [editTrade, setEditTrade] = useState("");
  const [editScope, setEditScope] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editSubName, setEditSubName] = useState("");

  const totalQuoted = quotes.reduce((sum, q) => sum + (Number(q.amount) || 0), 0);
  const receivedCount = quotes.filter(q => q.status === "received" || q.status === "accepted" || q.status === "approved").length;
  const approvedTotal = quotes.filter(q => q.status === "approved").reduce((sum, q) => sum + (Number(q.amount) || 0), 0);

  function startEditing(q: QuoteRequest) {
    setEditingId(q.id);
    setEditAmount(q.amount != null ? String(q.amount) : "");
    setEditTrade(q.trade || "");
    setEditScope(q.scope_description || "");
    setEditNotes(q.notes || "");
    setEditSubName(q.subcontractor_name);
  }

  function cancelEditing() {
    setEditingId(null);
  }

  async function saveEdits(quoteId: string) {
    setSaving(true);
    const updates: Record<string, unknown> = {
      amount: editAmount ? parseFloat(editAmount) : null,
      trade: editTrade || null,
      scope_description: editScope || null,
      notes: editNotes || null,
      subcontractor_name: editSubName,
    };

    const supabase = createClient();
    const { error } = await supabase.from("quote_requests").update(updates).eq("id", quoteId);
    if (!error) {
      setQuotes(prev => prev.map(q => q.id === quoteId ? { ...q, ...updates } as QuoteRequest : q));
    }
    setSaving(false);
    setEditingId(null);
  }

  async function updateStatus(quoteId: string, newStatus: QuoteRequestStatus) {
    const supabase = createClient();
    const updates: Record<string, unknown> = { status: newStatus };
    if (newStatus === "received" || newStatus === "accepted" || newStatus === "approved") {
      updates.received_at = new Date().toISOString();
    }
    const { error } = await supabase.from("quote_requests").update(updates).eq("id", quoteId);
    if (!error) {
      setQuotes(prev => prev.map(q => q.id === quoteId ? { ...q, ...updates } as QuoteRequest : q));
    }
  }

  function findAttachmentPath(q: QuoteRequest): string | null {
    if (q.attachment_storage_path) {
      if (!q.attachment_storage_path.includes("/") && q.gmail_message_id) {
        const email = linkedEmails.find(e => e.gmail_message_id === q.gmail_message_id);
        if (email?.attachments) {
          const att = (email.attachments as { filename?: string; storage_path?: string | null }[]).find(
            a => a.storage_path && (a.filename === q.attachment_storage_path || a.storage_path?.endsWith(q.attachment_storage_path!))
          );
          if (att?.storage_path) return att.storage_path;
        }
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

  function findAttachmentFilename(q: QuoteRequest): string {
    if (q.attachment_storage_path) {
      const parts = q.attachment_storage_path.split("/");
      return parts[parts.length - 1];
    }
    if (q.gmail_message_id) {
      const email = linkedEmails.find(e => e.gmail_message_id === q.gmail_message_id);
      if (email?.attachments) {
        const att = (email.attachments as { filename?: string; storage_path?: string | null }[]).find(
          a => a.storage_path && a.filename?.toLowerCase().endsWith(".pdf")
        );
        if (att?.filename) return att.filename;
      }
    }
    return `${q.subcontractor_name} - Quote.pdf`;
  }

  async function handleViewPdf(q: QuoteRequest) {
    const path = findAttachmentPath(q);
    if (!path) return;
    setLoadingQuoteId(q.id);
    try {
      const supabase = createClient();
      const { data } = await supabase.storage.from("email-attachments").createSignedUrl(path, 3600);
      if (data?.signedUrl) {
        setPreviewFilename(findAttachmentFilename(q));
        setPreviewUrl(data.signedUrl);
      }
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
      {/* Quote Coverage — estimate lines with linked quotes */}
      <QuoteCoverageView projectId={projectId} />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
        <div className="rounded-xl border bg-card p-3">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Approved (Bills)</div>
          <div className="text-lg font-bold text-cyan-500 mt-0.5">{formatCurrency(approvedTotal)}</div>
        </div>
      </div>

      {/* Quote List */}
      <div className="space-y-2">
        {quotes.map((q) => {
          const isExpanded = expandedId === q.id;
          const isEditing = editingId === q.id;
          const hasFile = !!findAttachmentPath(q);
          const isLoading = loadingQuoteId === q.id;
          const config = STATUS_CONFIG[q.status] || { label: q.status, color: "bg-muted text-foreground" };
          const isApproved = q.status === "approved";

          return (
            <div key={q.id} className={`rounded-xl border bg-card overflow-hidden ${isApproved ? "border-cyan-500/30 bg-cyan-500/[0.03]" : ""}`}>
              {/* Header Row */}
              <button
                type="button"
                onClick={() => { setExpandedId(isExpanded ? null : q.id); if (isExpanded) cancelEditing(); }}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
              >
                <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${isApproved ? "bg-cyan-100 dark:bg-cyan-900/30" : "bg-emerald-100 dark:bg-emerald-900/30"}`}>
                  {isApproved ? (
                    <ShieldCheck className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
                  ) : (
                    <DollarSign className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  )}
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
                    <div className={`text-sm font-semibold ${isApproved ? "text-cyan-500" : "text-green-500"}`}>{formatCurrency(Number(q.amount))}</div>
                  )}
                  <Badge variant="outline" className={`text-[9px] ${config.color}`}>
                    {config.label}
                  </Badge>
                </div>
                {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
              </button>

              {/* Expanded Detail */}
              {isExpanded && !isEditing && (
                <div className="px-4 pb-4 pt-1 border-t space-y-3">
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
                    {q.amount != null && (
                      <div>
                        <span className="text-muted-foreground">Amount:</span>{" "}
                        <span className="font-semibold text-green-500">{formatCurrency(Number(q.amount))}</span>
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

                  {q.scope_description && (
                    <div className="text-xs">
                      <span className="text-muted-foreground">Scope:</span> {q.scope_description}
                    </div>
                  )}

                  {q.extracted_text && (
                    <div className="rounded-lg bg-muted/50 p-3 text-xs max-h-40 overflow-y-auto whitespace-pre-wrap font-mono">
                      {q.extracted_text}
                    </div>
                  )}

                  {q.notes && (
                    <div className="text-xs">
                      <span className="text-muted-foreground">Notes:</span> {q.notes}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-1 flex-wrap">
                    {hasFile && (
                      <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleViewPdf(q)} disabled={isLoading}>
                        {isLoading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Eye className="h-3 w-3 mr-1" />}
                        View PDF
                      </Button>
                    )}
                    <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => startEditing(q)}>
                      <Pencil className="h-3 w-3 mr-1" /> Edit
                    </Button>

                    {/* Status selector */}
                    <Select value={q.status} onValueChange={(v) => updateStatus(q.id, v as QuoteRequestStatus)}>
                      <SelectTrigger className="h-7 w-auto text-xs gap-1">
                        <span>Status</span>
                      </SelectTrigger>
                      <SelectContent>
                        {ALL_STATUSES.map(s => (
                          <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {/* Scan & Link — AI reads quote and links to estimate lines */}
                    {q.status !== "approved" && q.status !== "declined" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
                        onClick={() => setScanQuoteId(q.id)}
                      >
                        <ScanSearch className="h-3 w-3 mr-1" /> Scan & Link
                      </Button>
                    )}
                    {/* Approve → opens split dialog to assign to budget lines */}
                    {q.status !== "approved" && q.status !== "declined" && (
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 text-xs bg-cyan-600 hover:bg-cyan-700 text-white"
                        onClick={() => setSplitQuoteId(q.id)}
                      >
                        <CheckCircle className="h-3 w-3 mr-1" /> Approve as Bill
                      </Button>
                    )}
                    {/* Decline */}
                    {q.status !== "approved" && q.status !== "declined" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10"
                        onClick={() => updateStatus(q.id, "declined")}
                      >
                        <X className="h-3 w-3 mr-1" /> Decline
                      </Button>
                    )}
                    {q.status === "declined" && (
                      <Badge className="text-[10px] bg-red-500/15 text-red-500 border-red-500/30">
                        Declined
                      </Badge>
                    )}
                    {q.status === "approved" && (
                      <Badge className="text-[10px] bg-cyan-500/15 text-cyan-500 border-cyan-500/30 gap-1">
                        <ShieldCheck className="h-3 w-3" /> Committed Expense
                      </Badge>
                    )}
                  </div>
                </div>
              )}

              {/* Inline Editing Form */}
              {isExpanded && isEditing && (
                <div className="px-4 pb-4 pt-1 border-t space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-muted-foreground font-medium uppercase">Subcontractor</label>
                      <Input value={editSubName} onChange={e => setEditSubName(e.target.value)} className="h-8 text-sm mt-1" />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground font-medium uppercase">Amount ($)</label>
                      <Input type="number" step="0.01" value={editAmount} onChange={e => setEditAmount(e.target.value)} placeholder="0.00" className="h-8 text-sm mt-1" />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground font-medium uppercase">Trade</label>
                      <Input value={editTrade} onChange={e => setEditTrade(e.target.value)} placeholder="e.g. Plumbing, Electrical" className="h-8 text-sm mt-1" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground font-medium uppercase">Scope Description</label>
                    <Textarea value={editScope} onChange={e => setEditScope(e.target.value)} placeholder="What's included..." className="text-sm mt-1 min-h-[60px]" />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground font-medium uppercase">Notes</label>
                    <Textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} placeholder="Internal notes..." className="text-sm mt-1 min-h-[40px]" />
                  </div>

                  {q.extracted_text && (
                    <details className="text-xs">
                      <summary className="text-muted-foreground cursor-pointer hover:text-foreground">Extracted PDF text (reference)</summary>
                      <div className="rounded-lg bg-muted/50 p-3 max-h-32 overflow-y-auto whitespace-pre-wrap font-mono mt-1">
                        {q.extracted_text}
                      </div>
                    </details>
                  )}

                  <div className="flex items-center gap-2 pt-1">
                    <Button size="sm" className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white" onClick={() => saveEdits(q.id)} disabled={saving}>
                      {saving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Check className="h-3 w-3 mr-1" />}
                      Save Changes
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={cancelEditing}>
                      <X className="h-3 w-3 mr-1" /> Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {previewUrl && (
        <PdfViewer url={previewUrl} filename={previewFilename} onClose={() => setPreviewUrl(null)} />
      )}

      {/* Quote split dialog — opens when "Approve as Bill" is clicked */}
      {splitQuoteId && (() => {
        const q = quotes.find((q) => q.id === splitQuoteId);
        if (!q) return null;
        return (
          <QuoteSplitDialog
            quoteId={q.id}
            projectId={projectId}
            quoteName={`${q.subcontractor_name} — ${q.trade || "General"}`}
            quoteAmount={Number(q.amount) || 0}
            onClose={() => setSplitQuoteId(null)}
            onComplete={() => {
              setSplitQuoteId(null);
              // Update quote status locally
              setQuotes((prev) =>
                prev.map((qq) =>
                  qq.id === q.id ? { ...qq, status: "approved" as QuoteRequestStatus } : qq
                )
              );
            }}
          />
        );
      })()}

      {/* Quote scan dialog — AI reads quote and links to estimate lines */}
      {scanQuoteId && (() => {
        const q = quotes.find((q) => q.id === scanQuoteId);
        if (!q) return null;
        return (
          <QuoteScanDialog
            quoteId={q.id}
            projectId={projectId}
            quoteName={`${q.subcontractor_name} — ${q.trade || "General"}`}
            quoteAmount={Number(q.amount) || 0}
            onClose={() => setScanQuoteId(null)}
            onComplete={() => {
              setScanQuoteId(null);
              // Refresh by reloading — the quote may have been split
              window.location.reload();
            }}
          />
        );
      })()}
    </div>
  );
}
