"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Check,
  SkipForward,
  ArrowRight,
  Mail,
  ArrowUpRight,
  ArrowDownLeft,
  Loader2,
  CheckCheck,
  X,
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

// ── Helper ──────────────────

function summarizeActions(actions: TriageAction[]): string {
  if (actions.length === 0 || (actions.length === 1 && actions[0].type === "skip")) {
    return "Skip — no action needed";
  }
  if (actions.length === 1 && actions[0].type === "log_email") {
    return `Log as ${actions[0].data.category || "other"}${actions[0].data.project_name ? ` → ${actions[0].data.project_name}` : ""}`;
  }

  const parts: string[] = [];
  for (const a of actions) {
    switch (a.type) {
      case "create_project":
        parts.push(`New project: "${a.data.name}" (${a.data.status})`);
        break;
      case "create_customer":
        parts.push(`New customer: ${a.data.first_name} ${a.data.last_name}`);
        break;
      case "create_subcontractor":
        parts.push(`New sub: ${a.data.company_name}`);
        break;
      case "create_quote":
        parts.push(`Quote: ${a.data.subcontractor_name} → ${a.data.project_name}${a.data.amount ? ` ($${Number(a.data.amount).toLocaleString()})` : ""}`);
        break;
      case "create_follow_up":
        parts.push(`Follow-up: ${a.data.contact_name} — ${a.data.description}`);
        break;
      case "update_project_stage":
        parts.push(`Update: ${a.data.project_name} → ${a.data.new_status}`);
        break;
      case "log_email":
        parts.push(`Log → ${a.data.project_name || "general"}`);
        break;
    }
  }
  return parts.join(" | ");
}

function getActionColor(actions: TriageAction[]): string {
  if (actions.some((a) => a.type === "create_project")) return "border-blue-500/50";
  if (actions.some((a) => a.type === "create_quote")) return "border-green-500/50";
  if (actions.some((a) => a.type === "create_follow_up")) return "border-orange-500/50";
  if (actions.some((a) => a.type === "create_customer" || a.type === "create_subcontractor")) return "border-purple-500/50";
  return "border-border";
}

// ── Component ──────────────────

export function EmailTriageWizard({ items, isScanning, onComplete, onCancel }: EmailTriageWizardProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [decisions, setDecisions] = useState<Record<string, "confirmed" | "skipped">>({});
  const [saving, setSaving] = useState(false);
  const [showSummary, setShowSummary] = useState(false);

  // Items stream in live from parent — use them directly
  const current = items[currentIndex];
  const confirmed = items.filter((i) => decisions[i.email.id] === "confirmed");
  const skipped = items.filter((i) => decisions[i.email.id] === "skipped");
  const pending = items.filter((i) => !decisions[i.email.id]);
  const isLast = currentIndex >= items.length - 1;
  const waitingForMore = isLast && isScanning;

  function handleConfirm() {
    if (current) {
      setDecisions((prev) => ({ ...prev, [current.email.id]: "confirmed" }));
    }
    if (isLast && !isScanning) setShowSummary(true);
    else setCurrentIndex((i) => Math.min(i + 1, items.length - 1));
  }

  function handleSkip() {
    if (current) {
      setDecisions((prev) => ({ ...prev, [current.email.id]: "skipped" }));
    }
    if (isLast && !isScanning) setShowSummary(true);
    else setCurrentIndex((i) => Math.min(i + 1, items.length - 1));
  }

  function handleSkipAll() {
    setShowSummary(true);
  }

  async function handleSave() {
    setSaving(true);
    const confirmedItems = items.filter((i) => decisions[i.email.id] === "confirmed");
    await onComplete(confirmedItems);
    setSaving(false);
  }

  // Summary view
  if (showSummary) {
    const createActions = confirmed.flatMap((i) => i.actions).filter((a) =>
      ["create_project", "create_customer", "create_subcontractor", "create_quote", "create_follow_up"].includes(a.type)
    );
    const projects = createActions.filter((a) => a.type === "create_project");
    const customers = createActions.filter((a) => a.type === "create_customer");
    const subs = createActions.filter((a) => a.type === "create_subcontractor");
    const quotes = createActions.filter((a) => a.type === "create_quote");
    const followUps = createActions.filter((a) => a.type === "create_follow_up");

    return (
      <Dialog open onOpenChange={() => onCancel()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Ready to Save</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Reviewed {confirmed.length + skipped.length} of {triageItems.length} emails.
              {pending.length > 0 && ` ${pending.length} still pending.`}
            </p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="border rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-blue-400">{projects.length}</div>
                <div className="text-muted-foreground">Projects</div>
              </div>
              <div className="border rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-purple-400">{customers.length}</div>
                <div className="text-muted-foreground">Customers</div>
              </div>
              <div className="border rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-orange-400">{subs.length}</div>
                <div className="text-muted-foreground">Subs</div>
              </div>
              <div className="border rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-green-400">{quotes.length}</div>
                <div className="text-muted-foreground">Quotes</div>
              </div>
            </div>
            {followUps.length > 0 && (
              <p className="text-sm text-muted-foreground">{followUps.length} follow-ups</p>
            )}
            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowSummary(false)} disabled={saving}>
                Back to Review
              </Button>
              <Button onClick={handleSave} disabled={saving} className="flex-1">
                {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCheck className="h-4 w-4 mr-2" />}
                Save All ({confirmed.length} emails)
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Waiting for first batch or caught up to scanning
  if (!current || (waitingForMore && decisions[current?.email?.id])) {
    return (
      <Dialog open onOpenChange={() => onCancel()}>
        <DialogContent className="max-w-md">
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
            <div className="text-center">
              <p className="font-medium">Scanning your emails...</p>
              <p className="text-sm text-muted-foreground mt-1">
                {items.length > 0
                  ? `${items.length} emails analyzed so far. Waiting for more...`
                  : "Reading your Gmail inbox. First batch coming up..."}
              </p>
              {confirmed.length > 0 && (
                <p className="text-xs text-green-400 mt-2">{confirmed.length} confirmed so far</p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const isSkipType = current.actions.length === 0 ||
    (current.actions.length === 1 && (current.actions[0].type === "skip" || current.actions[0].type === "log_email"));

  return (
    <Dialog open onOpenChange={() => onCancel()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        {/* Header with progress */}
        <div className="flex items-center justify-between">
          <DialogTitle className="text-base">Email Triage</DialogTitle>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="text-green-400">{confirmed.length} confirmed</span>
            <span>{skipped.length} skipped</span>
            <span className="font-medium text-foreground">{currentIndex + 1} / {items.length}{isScanning ? "+" : ""}</span>
            {isScanning && <Loader2 className="h-3 w-3 animate-spin text-amber-500" />}
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-amber-500 rounded-full transition-all"
            style={{ width: `${items.length > 0 ? ((currentIndex + 1) / items.length) * 100 : 0}%` }}
          />
        </div>

        {/* Email card */}
        <div className={`border-2 rounded-lg p-4 space-y-3 ${getActionColor(current.actions)}`}>
          {/* Email header */}
          <div className="flex items-start gap-2">
            <div className={`p-1.5 rounded ${current.email.direction === "inbound" ? "bg-blue-500/20" : "bg-green-500/20"}`}>
              {current.email.direction === "inbound"
                ? <ArrowDownLeft className="h-4 w-4 text-blue-400" />
                : <ArrowUpRight className="h-4 w-4 text-green-400" />
              }
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate">{current.email.subject}</p>
              <p className="text-xs text-muted-foreground">
                {current.email.direction === "inbound" ? "From" : "To"}: {current.email.from} &lt;{current.email.fromEmail}&gt;
              </p>
              <p className="text-xs text-muted-foreground">
                {new Date(current.email.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </p>
            </div>
            <Badge variant="outline" className="shrink-0 text-[10px]">
              {current.email.direction}
            </Badge>
          </div>

          {/* Email body preview */}
          <div className="bg-muted/50 rounded p-3 text-xs text-muted-foreground max-h-32 overflow-y-auto whitespace-pre-wrap">
            {current.email.snippet || "No preview available"}
          </div>

          {/* AI Suggestion */}
          <div className="bg-amber-500/10 border border-amber-500/20 rounded p-3">
            <p className="text-xs font-medium text-amber-400 mb-1">AI Suggestion:</p>
            <p className="text-sm">{summarizeActions(current.actions)}</p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 pt-1">
          {isSkipType ? (
            <>
              <Button onClick={handleSkip} variant="outline" className="flex-1">
                <SkipForward className="h-4 w-4 mr-2" />
                Skip
              </Button>
              <Button onClick={handleConfirm} className="flex-1 bg-green-600 hover:bg-green-700">
                <Check className="h-4 w-4 mr-2" />
                Log It
              </Button>
            </>
          ) : (
            <>
              <Button onClick={handleSkip} variant="outline" size="sm">
                <X className="h-4 w-4 mr-1" />
                Skip
              </Button>
              <Button onClick={handleConfirm} className="flex-1 bg-green-600 hover:bg-green-700">
                <Check className="h-4 w-4 mr-2" />
                Confirm
              </Button>
            </>
          )}
          {!isLast && (
            <Button onClick={handleSkipAll} variant="ghost" size="sm" className="text-muted-foreground">
              Done Reviewing
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
