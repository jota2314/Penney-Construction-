"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Check,
  X,
  Pencil,
  ArrowRight,
  ArrowUpRight,
  ArrowDownLeft,
  Loader2,
  CheckCheck,
  Paperclip,
} from "lucide-react";

// ── Types ──────────────────

export interface TriageEmail {
  id: string;
  subject: string;
  from: string;
  fromEmail: string;
  to: string;
  toEmail: string;
  date: string;
  direction: "inbound" | "outbound";
  snippet: string;
  attachments?: { filename: string; mimeType: string; attachmentId: string; size: number }[];
}

export interface TriageAction {
  type: string;
  data: Record<string, unknown>;
}

export interface TriageItem {
  email: TriageEmail;
  actions: TriageAction[];
  status: "pending" | "confirmed" | "skipped" | "edited";
}

interface EmailTriageWizardProps {
  items: TriageItem[];
  isScanning?: boolean;
  onComplete: (confirmed: TriageItem[]) => Promise<void>;
  onCancel: () => void;
}

// ── Helpers ──────────────────

function describeActions(actions: TriageAction[]): { lines: ActionLine[]; isEmpty: boolean } {
  const lines: ActionLine[] = [];

  for (const a of actions) {
    if (!a.data) continue;
    switch (a.type) {
      case "create_project":
        lines.push({ icon: "🏗️", label: "New Project", detail: `${a.data.name}`, sub: [a.data.project_type, a.data.status, a.data.city].filter(Boolean).join(" · "), color: "text-blue-400" });
        break;
      case "create_customer":
        lines.push({ icon: "👤", label: "New Client", detail: `${a.data.first_name} ${a.data.last_name}`, sub: [a.data.email, a.data.phone].filter(Boolean).join(" · "), color: "text-purple-400" });
        break;
      case "create_subcontractor":
        lines.push({ icon: "🔧", label: "New Sub", detail: `${a.data.company_name}`, sub: ((a.data.trades as string[]) || []).join(", "), color: "text-orange-400" });
        break;
      case "create_quote":
        lines.push({ icon: "💰", label: "Quote", detail: `${a.data.subcontractor_name} → ${a.data.project_name}`, sub: a.data.amount ? `$${Number(a.data.amount).toLocaleString()} — ${a.data.trade || ""}` : (a.data.trade as string) || "", color: "text-green-400" });
        break;
      case "create_todo":
        lines.push({ icon: "📋", label: "Todo", detail: `${a.data.contact_name}`, sub: (a.data.description as string) || "", color: "text-yellow-400" });
        break;
      case "update_project_stage":
        lines.push({ icon: "📊", label: "Update", detail: `${a.data.project_name} → ${a.data.new_status}`, color: "text-cyan-400" });
        break;
      case "log_email":
        lines.push({ icon: "📧", label: "Log", detail: `${a.data.project_name || "general"}`, sub: (a.data.category as string) || "", color: "text-zinc-400" });
        break;
    }
  }

  const isEmpty = lines.length === 0 || (lines.length === 1 && lines[0].label === "Log" && !lines[0].detail);
  return { lines, isEmpty };
}

interface ActionLine {
  icon: string;
  label: string;
  detail: string;
  sub?: string;
  color: string;
}

// ── Main Component ──────────────────

export function EmailTriageWizard({ items, isScanning, onComplete, onCancel }: EmailTriageWizardProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [decisions, setDecisions] = useState<Record<string, "confirmed" | "skipped">>({});
  const [saving, setSaving] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [editing, setEditing] = useState(false);

  const current = items[currentIndex];
  const confirmed = items.filter((i) => decisions[i.email.id] === "confirmed");
  const skipped = items.filter((i) => decisions[i.email.id] === "skipped");
  const isLast = currentIndex >= items.length - 1;
  const waitingForMore = isLast && isScanning;

  function advance() {
    setEditing(false);
    if (isLast && !isScanning) setShowSummary(true);
    else setCurrentIndex((i) => Math.min(i + 1, items.length - 1));
  }

  function handleApprove() {
    if (current) setDecisions((prev) => ({ ...prev, [current.email.id]: "confirmed" }));
    advance();
  }

  function handleReject() {
    if (current) setDecisions((prev) => ({ ...prev, [current.email.id]: "skipped" }));
    advance();
  }

  async function handleSave() {
    setSaving(true);
    const confirmedItems = items.filter((i) => decisions[i.email.id] === "confirmed");
    await onComplete(confirmedItems);
    setSaving(false);
  }

  // ── Summary ──────────────────
  if (showSummary) {
    const allActions = confirmed.flatMap((i) => i.actions).filter((a) => a.data &&
      ["create_project", "create_customer", "create_subcontractor", "create_quote", "create_todo"].includes(a.type)
    );

    const counts = {
      projects: allActions.filter((a) => a.type === "create_project").length,
      customers: allActions.filter((a) => a.type === "create_customer").length,
      subs: allActions.filter((a) => a.type === "create_subcontractor").length,
      quotes: allActions.filter((a) => a.type === "create_quote").length,
      todos: allActions.filter((a) => a.type === "create_todo").length,
    };

    return (
      <Dialog open onOpenChange={() => onCancel()}>
        <DialogContent className="max-w-lg">
          <DialogTitle>Ready to Save</DialogTitle>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {confirmed.length} approved, {skipped.length} rejected out of {items.length} emails.
            </p>
            <div className="grid grid-cols-3 gap-2 text-sm">
              {[
                { n: counts.projects, label: "Projects", color: "text-blue-400" },
                { n: counts.customers, label: "Clients", color: "text-purple-400" },
                { n: counts.subs, label: "Subs", color: "text-orange-400" },
                { n: counts.quotes, label: "Quotes", color: "text-green-400" },
                { n: counts.todos, label: "Todos", color: "text-yellow-400" },
              ].filter((s) => s.n > 0).map((s) => (
                <div key={s.label} className="border rounded-lg p-3 text-center">
                  <div className={`text-2xl font-bold ${s.color}`}>{s.n}</div>
                  <div className="text-xs text-muted-foreground">{s.label}</div>
                </div>
              ))}
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowSummary(false)} disabled={saving}>Back</Button>
              <Button onClick={handleSave} disabled={saving} className="flex-1">
                {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCheck className="h-4 w-4 mr-2" />}
                Save All
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Waiting ──────────────────
  if (!current || (waitingForMore && decisions[current?.email?.id])) {
    return (
      <Dialog open onOpenChange={() => onCancel()}>
        <DialogContent className="max-w-md">
          <DialogTitle className="sr-only">Scanning</DialogTitle>
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
            <p className="font-medium">Scanning your emails...</p>
            <p className="text-sm text-muted-foreground">
              {items.length > 0 ? `${items.length} analyzed. Waiting for more...` : "First batch coming up..."}
            </p>
            {confirmed.length > 0 && (
              <p className="text-xs text-green-400">{confirmed.length} approved so far</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Main triage ──────────────────
  const { lines, isEmpty } = describeActions(current.actions);

  return (
    <Dialog open onOpenChange={() => onCancel()}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <DialogTitle className="text-base">Email Triage</DialogTitle>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="text-green-400">{confirmed.length} approved</span>
            <span className="text-red-400">{skipped.length} rejected</span>
            <span className="font-medium text-foreground">{currentIndex + 1}/{items.length}{isScanning ? "+" : ""}</span>
            {isScanning && <Loader2 className="h-3 w-3 animate-spin text-amber-500" />}
          </div>
        </div>

        {/* Progress */}
        <div className="h-1 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-amber-500 rounded-full transition-all"
            style={{ width: `${items.length > 0 ? ((currentIndex + 1) / items.length) * 100 : 0}%` }} />
        </div>

        {/* Email */}
        <div className="border rounded-lg p-4 space-y-3 flex-1 min-h-0 overflow-y-auto">
          {/* Header */}
          <div className="flex items-start gap-2">
            <div className={`p-1.5 rounded shrink-0 ${current.email.direction === "inbound" ? "bg-blue-500/20" : "bg-green-500/20"}`}>
              {current.email.direction === "inbound"
                ? <ArrowDownLeft className="h-4 w-4 text-blue-400" />
                : <ArrowUpRight className="h-4 w-4 text-green-400" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">{current.email.subject}</p>
              <p className="text-xs text-muted-foreground">
                {current.email.direction === "inbound" ? "From" : "To"}: {current.email.from}
              </p>
              <p className="text-xs text-muted-foreground">
                {new Date(current.email.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </p>
            </div>
          </div>

          {/* Body */}
          <div className="bg-muted/50 rounded p-3 text-xs text-muted-foreground max-h-28 overflow-y-auto whitespace-pre-wrap">
            {current.email.snippet || "No preview"}
          </div>

          {/* Attachments */}
          {current.email.attachments && current.email.attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {current.email.attachments.map((att, i) => (
                <Badge key={i} variant="outline" className="text-[10px] gap-1">
                  <Paperclip className="h-2.5 w-2.5" />{att.filename}
                </Badge>
              ))}
            </div>
          )}

          {/* AI Actions */}
          <div className={`border rounded-lg p-3 space-y-2 ${editing ? "bg-blue-500/10 border-blue-500/30" : "bg-amber-500/10 border-amber-500/20"}`}>
            <p className="text-xs font-medium text-amber-400">{editing ? "Edit actions:" : "AI will do:"}</p>
            {isEmpty ? (
              <p className="text-sm text-muted-foreground">Nothing — skip this email</p>
            ) : (
              <div className="space-y-1.5">
                {lines.map((line, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="text-sm shrink-0">{line.icon}</span>
                    <div className="min-w-0">
                      <span className={`text-xs font-medium ${line.color}`}>{line.label}: </span>
                      <span className="text-sm">{line.detail}</span>
                      {line.sub && <p className="text-xs text-muted-foreground">{line.sub}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Three buttons: Reject / Edit / Approve */}
        <div className="flex gap-2">
          <Button onClick={handleReject} variant="outline" className="flex-1 h-12 text-red-400 border-red-500/30 hover:bg-red-500/10">
            <X className="h-5 w-5 mr-2" />
            Reject
          </Button>
          <Button onClick={() => setEditing(!editing)} variant="outline" className="flex-1 h-12">
            <Pencil className="h-5 w-5 mr-2" />
            Edit
          </Button>
          <Button onClick={handleApprove} className="flex-1 h-12 bg-green-600 hover:bg-green-700">
            <Check className="h-5 w-5 mr-2" />
            Approve
          </Button>
        </div>
        <Button onClick={() => setShowSummary(true)} variant="ghost" size="sm" className="text-muted-foreground self-center">
          Done Reviewing <ArrowRight className="h-4 w-4 ml-1" />
        </Button>
      </DialogContent>
    </Dialog>
  );
}
