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
  Loader2,
  ArrowDownLeft,
  ArrowUpRight,
  Inbox,
  RefreshCw,
  Paperclip,
} from "lucide-react";
import { saveApprovedDraft } from "@/lib/actions/ai-email-engine";
import { useRouter } from "next/navigation";

interface EmailMeta {
  id: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  snippet: string;
}

interface AnalysisResult {
  match: string;
  project_name: string;
  summary: string;
  actions: { type: string; data: Record<string, unknown> }[];
}

interface EmailDetail {
  id: string;
  subject: string;
  from: string;
  fromEmail: string;
  to: string;
  toEmail: string;
  date: string;
  direction: string;
  snippet: string;
  attachments: { filename: string; mimeType: string }[];
}

export function EmailInbox() {
  const [emails, setEmails] = useState<EmailMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<{ result: AnalysisResult; email: EmailDetail } | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  async function fetchEmails() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/email-list?limit=50");
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setEmails(data.emails || []);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to load emails");
    } finally {
      setLoading(false);
    }
  }

  async function analyzeEmail(emailId: string) {
    setAnalyzing(emailId);
    setAnalysis(null);
    setMessage(null);
    try {
      const res = await fetch("/api/analyze-single-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailId }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setAnalysis({ result: data.analysis, email: data.email });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to analyze");
    } finally {
      setAnalyzing(null);
    }
  }

  async function handleApprove() {
    if (!analysis) return;
    setSaving(true);
    try {
      const actions = (analysis.result.actions || []).filter(
        (a) => a.type !== "skip" && a.data
      );
      if (actions.length > 0) {
        await saveApprovedDraft(actions);
      }
      setMessage(`Saved: ${analysis.result.summary}`);
      setAnalysis(null);
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  function handleReject() {
    setAnalysis(null);
    setMessage("Skipped");
  }

  const isCompanyEmail = (email: string) =>
    email.includes("penneyconstructioninc.com");

  return (
    <div className="space-y-3">
      {/* Load emails button */}
      {emails.length === 0 && (
        <Button onClick={fetchEmails} disabled={loading} variant="outline"
          className="text-blue-400 border-blue-500/30 hover:bg-blue-500/10">
          {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Inbox className="h-4 w-4 mr-2" />}
          {loading ? "Loading..." : "Load Recent Emails"}
        </Button>
      )}

      {emails.length > 0 && !analysis && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{emails.length} emails — click one to analyze</p>
          <Button onClick={fetchEmails} disabled={loading} variant="ghost" size="sm">
            <RefreshCw className={`h-3 w-3 mr-1 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      )}

      {/* Message */}
      {message && (
        <p className="text-xs text-muted-foreground bg-muted rounded px-2 py-1">{message}</p>
      )}

      {/* Email list */}
      {emails.length > 0 && !analysis && (
        <div className="border rounded-lg divide-y max-h-[60vh] overflow-y-auto">
          {emails.map((email) => {
            const isOut = isCompanyEmail(email.from);
            return (
              <button
                key={email.id}
                onClick={() => analyzeEmail(email.id)}
                disabled={analyzing === email.id}
                className="w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors flex items-start gap-2"
              >
                <div className={`p-1 rounded shrink-0 mt-0.5 ${isOut ? "bg-green-500/20" : "bg-blue-500/20"}`}>
                  {isOut
                    ? <ArrowUpRight className="h-3 w-3 text-green-400" />
                    : <ArrowDownLeft className="h-3 w-3 text-blue-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{email.subject || "(no subject)"}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {isOut ? `To: ${email.to}` : `From: ${email.from}`}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{email.snippet}</p>
                </div>
                <div className="text-[10px] text-muted-foreground shrink-0">
                  {new Date(email.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </div>
                {analyzing === email.id && <Loader2 className="h-4 w-4 animate-spin text-amber-500 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}

      {/* Analysis result dialog */}
      {analysis && (
        <Dialog open onOpenChange={() => setAnalysis(null)}>
          <DialogContent className="max-w-lg">
            <DialogTitle className="text-base">{analysis.email.subject}</DialogTitle>

            {/* Email info */}
            <div className="text-xs text-muted-foreground space-y-0.5">
              <p>{analysis.email.direction === "inbound" ? "From" : "To"}: {analysis.email.from}</p>
              <p>{new Date(analysis.email.date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>
            </div>

            {/* Snippet */}
            <div className="bg-muted/50 rounded p-3 text-xs text-muted-foreground max-h-24 overflow-y-auto whitespace-pre-wrap">
              {analysis.email.snippet}
            </div>

            {/* Attachments */}
            {analysis.email.attachments.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {analysis.email.attachments.map((a, i) => (
                  <Badge key={i} variant="outline" className="text-[10px] gap-1">
                    <Paperclip className="h-2.5 w-2.5" />{a.filename}
                  </Badge>
                ))}
              </div>
            )}

            {/* AI Analysis */}
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 space-y-3">
              {/* Match type */}
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className={
                  analysis.result.match === "new_project" ? "bg-blue-500/20 text-blue-400"
                    : analysis.result.match === "existing" ? "bg-green-500/20 text-green-400"
                    : "bg-zinc-500/20 text-zinc-400"
                }>
                  {analysis.result.match === "new_project" ? "New Project"
                    : analysis.result.match === "existing" ? "Existing Project"
                    : "Skip"}
                </Badge>
                {analysis.result.project_name && (
                  <span className="font-medium text-sm">{analysis.result.project_name}</span>
                )}
              </div>

              {/* Summary */}
              <p className="text-sm">{analysis.result.summary}</p>

              {/* Actions detail */}
              {analysis.result.actions?.filter((a) => a.data && a.type !== "log_email" && a.type !== "skip").map((action, i) => (
                <div key={i} className="text-xs border-t border-amber-500/20 pt-2">
                  <span className="font-medium text-amber-400">
                    {action.type === "create_project" ? "Create Project"
                      : action.type === "create_customer" ? "Create Client"
                      : action.type === "create_subcontractor" ? "Create Sub"
                      : action.type === "create_quote" ? "Create Quote"
                      : action.type === "create_follow_up" ? "Follow-up"
                      : action.type}:
                  </span>{" "}
                  {action.type === "create_project" && (
                    <span>{action.data.name} — {action.data.project_type} [{action.data.status}] {action.data.address && `at ${action.data.address}`} {action.data.city && `, ${action.data.city}`}</span>
                  )}
                  {action.type === "create_customer" && (
                    <span>{action.data.first_name} {action.data.last_name} {action.data.email && `<${action.data.email}>`} {action.data.phone && `${action.data.phone}`}</span>
                  )}
                  {action.type === "create_subcontractor" && (
                    <span>{action.data.company_name} — {((action.data.trades as string[]) || []).join(", ")}</span>
                  )}
                  {action.type === "create_quote" && (
                    <span>{action.data.subcontractor_name} → {action.data.project_name} {action.data.amount && `$${Number(action.data.amount).toLocaleString()}`}</span>
                  )}
                  {action.type === "create_follow_up" && (
                    <span>{action.data.contact_name}: {action.data.description}</span>
                  )}
                </div>
              ))}
            </div>

            {/* 3 Buttons */}
            <div className="flex gap-2">
              <Button onClick={handleReject} variant="outline" className="flex-1 h-11 text-red-400 border-red-500/30">
                <X className="h-4 w-4 mr-2" />
                Reject
              </Button>
              <Button onClick={handleApprove} disabled={saving} className="flex-1 h-11 bg-green-600 hover:bg-green-700">
                {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
                Approve
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
