"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw, Check, AlertCircle, Brain, Zap } from "lucide-react";
import {
  clearAllData,
  getNewEmailIds,
  saveBatchResults,
  saveApprovedDraft,
  type BatchResult,
} from "@/lib/actions/ai-email-engine";
import { useRouter } from "next/navigation";
import { EmailTriageWizard, type TriageItem, type TriageEmail } from "./email-triage-wizard";

// ── Helpers ──────────────────

function formatResult(r: BatchResult) {
  const parts: string[] = [];
  if (r.projectsCreated > 0) parts.push(`${r.projectsCreated} projects`);
  if (r.customersCreated > 0) parts.push(`${r.customersCreated} customers`);
  if (r.subsCreated > 0) parts.push(`${r.subsCreated} subs`);
  if (r.quotesCreated > 0) parts.push(`${r.quotesCreated} quotes`);
  if (r.todosCreated > 0) parts.push(`${r.todosCreated} todos`);
  if (r.stagesUpdated > 0) parts.push(`${r.stagesUpdated} stages`);
  if (r.emailsProcessed > 0) parts.push(`${r.emailsProcessed} emails`);
  return parts;
}

async function analyzeEmailBatch(emailIds: string[]): Promise<{
  decisions: { email_index: number; actions: { type: string; data: Record<string, unknown> }[] }[];
  emails: { id: string; subject: string; fromEmail: string; toEmail: string; direction: "inbound" | "outbound"; date: string; from: string }[];
  error?: string;
}> {
  const res = await fetch("/api/analyze-emails", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emailIds }),
  });
  const data = await res.json();
  if (!res.ok) return { decisions: [], emails: [], error: data.error || `HTTP ${res.status}` };
  return data;
}


// ── Component ──────────────────

export function SyncButton() {
  const [syncing, setSyncing] = useState(false);
  const [scanType, setScanType] = useState<"sync" | "deep">("sync");
  const [progress, setProgress] = useState({ current: 0, total: 0, label: "" });
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [triageItems, setTriageItems] = useState<TriageItem[] | null>(null);
  const router = useRouter();

  function parseTriageItems(
    decisions: { email_index: number; actions: { type: string; data: Record<string, unknown> }[] }[],
    emailsData: Record<string, unknown>[]
  ): TriageItem[] {
    const items: TriageItem[] = [];
    for (const decision of decisions) {
      const emailData = emailsData[decision.email_index];
      if (!emailData) continue;

      const email: TriageEmail = {
        id: emailData.id as string,
        subject: emailData.subject as string,
        from: emailData.from as string,
        fromEmail: emailData.fromEmail as string,
        to: (emailData.to as string) || (emailData.toEmail as string),
        toEmail: emailData.toEmail as string,
        date: emailData.date as string,
        direction: emailData.direction as "inbound" | "outbound",
        snippet: (emailData.snippet as string) || "",
        attachments: (emailData.attachments as TriageEmail["attachments"]) || [],
      };

      items.push({
        email,
        actions: decision.actions || [],
        status: "pending",
      });
    }

    // Actionable emails first
    items.sort((a, b) => {
      const aHasAction = a.actions.some((act) => act.type.startsWith("create_") || act.type === "update_project_stage");
      const bHasAction = b.actions.some((act) => act.type.startsWith("create_") || act.type === "update_project_stage");
      if (aHasAction && !bHasAction) return -1;
      if (!aHasAction && bHasAction) return 1;
      return 0;
    });

    return items;
  }

  async function processBatchesStreaming(emailIds: string[]) {
    const batchSize = 5;
    const totalBatches = Math.ceil(emailIds.length / batchSize);

    for (let i = 0; i < emailIds.length; i += batchSize) {
      const batch = emailIds.slice(i, Math.min(i + batchSize, emailIds.length));
      const batchNum = Math.floor(i / batchSize) + 1;
      setProgress({ current: batchNum, total: totalBatches, label: `AI analyzing batch ${batchNum}/${totalBatches}...` });

      const { decisions, emails: emailsData, error } = await analyzeEmailBatch(batch);
      if (error) continue;
      if (!decisions || decisions.length === 0) continue;

      const newItems = parseTriageItems(decisions, emailsData as Record<string, unknown>[]);

      // Add new items to triage — wizard is already open, items stream in live
      setTriageItems((prev) => {
        const existing = prev || [];
        return [...existing, ...newItems];
      });
    }

    setSyncing(false);
    setProgress({ current: 0, total: 0, label: "" });
  }

  // Quick sync — still saves directly (incremental)
  async function handleSync() {
    setSyncing(true);
    setScanType("sync");
    setResult(null);
    setProgress({ current: 0, total: 0, label: "" });

    const totals: BatchResult = {
      emailsProcessed: 0, projectsCreated: 0, customersCreated: 0, subsCreated: 0,
      quotesCreated: 0, invoicesCreated: 0, todosCreated: 0, stagesUpdated: 0, errors: [],
    };

    try {
      const emailIds = await getNewEmailIds(50);
      if (emailIds.length === 0) {
        setResult({ success: true, message: "No new emails" });
        setSyncing(false);
        return;
      }

      const batchSize = 25;
      const totalBatches = Math.ceil(emailIds.length / batchSize);
      setProgress({ current: 0, total: totalBatches, label: "Syncing..." });

      for (let i = 0; i < emailIds.length; i += batchSize) {
        const batch = emailIds.slice(i, Math.min(i + batchSize, emailIds.length));
        setProgress({ current: Math.floor(i / batchSize) + 1, total: totalBatches, label: `Processing batch...` });
        const { decisions, emails: emailsData, error } = await analyzeEmailBatch(batch);
        if (error) { totals.errors.push(error); continue; }
        if (!decisions || decisions.length === 0) continue;
        const r = await saveBatchResults(decisions, emailsData);
        totals.emailsProcessed += r.emailsProcessed;
        totals.projectsCreated += r.projectsCreated;
        totals.customersCreated += r.customersCreated;
        totals.subsCreated += r.subsCreated;
        totals.quotesCreated += r.quotesCreated;
        totals.invoicesCreated += r.invoicesCreated;
        totals.todosCreated += r.todosCreated;
        totals.stagesUpdated += r.stagesUpdated;
        totals.errors.push(...r.errors);
      }

      const parts = formatResult(totals);
      setResult({ success: true, message: parts.length > 0 ? `Done: ${parts.join(", ")}` : "No new data" });
      router.refresh();
    } catch (err) {
      setResult({ success: false, message: err instanceof Error ? err.message : "Failed to sync." });
    } finally {
      setSyncing(false);
    }
  }

  // Deep Scan — opens wizard immediately, streams emails in as batches complete
  async function handleDeepScan() {
    if (!confirm("Deep Scan: Read your last 300 emails and review each one. Continue?")) return;

    setSyncing(true);
    setScanType("deep");
    setResult(null);
    setProgress({ current: 0, total: 0, label: "Fetching email list..." });

    try {
      const emailIds = await getNewEmailIds(300);

      if (emailIds.length === 0) {
        setResult({ success: true, message: "No emails found" });
        setSyncing(false);
        return;
      }

      // Open the wizard immediately with empty list — items will stream in
      setTriageItems([]);

      // Process batches in background — each batch adds items to the wizard
      processBatchesStreaming(emailIds);

    } catch (err) {
      setResult({ success: false, message: err instanceof Error ? err.message : "Deep scan failed." });
      setSyncing(false);
    }
  }

  async function handleTriageComplete(confirmedItems: TriageItem[]) {
    setSyncing(true);
    setProgress({ current: 0, total: 0, label: "Clearing old data..." });

    try {
      await clearAllData();

      setProgress({ current: 0, total: 0, label: "Saving confirmed data..." });

      // Collect all actions from confirmed items, sorted: customers/subs first, then projects, then quotes/todos
      const allActions = confirmedItems.flatMap((item) => item.actions)
        .filter((a) => a.type !== "skip" && a.type !== "log_email")
        .sort((a, b) => {
          const priority: Record<string, number> = {
            create_customer: 0, create_subcontractor: 0,
            create_project: 1, update_project_stage: 2,
            create_quote: 3, create_todo: 3,
          };
          return (priority[a.type] ?? 4) - (priority[b.type] ?? 4);
        });

      const r = await saveApprovedDraft(allActions);

      setTriageItems(null);
      setResult({
        success: true,
        message: `Created: ${r.projectsCreated} projects, ${r.customersCreated} customers, ${r.subsCreated} subs, ${r.quotesCreated} quotes, ${r.todosCreated} todos`,
      });
      router.refresh();
    } catch (err) {
      setResult({ success: false, message: err instanceof Error ? err.message : "Save failed." });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Button onClick={handleSync} disabled={syncing} variant="outline"
          className="text-blue-400 border-blue-500/30 hover:bg-blue-500/10">
          {syncing && scanType === "sync"
            ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            : <Brain className="h-4 w-4 mr-2" />}
          {syncing && scanType === "sync" ? "Processing..." : "AI Sync Gmail"}
        </Button>
        <Button onClick={handleDeepScan} disabled={syncing} variant="outline"
          className="text-orange-400 border-orange-500/30 hover:bg-orange-500/10">
          {syncing && scanType === "deep"
            ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            : <Zap className="h-4 w-4 mr-2" />}
          {syncing && scanType === "deep" ? "Scanning..." : "Deep Scan"}
        </Button>
      </div>

      {/* Progress bar */}
      {syncing && progress.total > 0 && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{progress.label}</span>
            <span>{progress.current}/{progress.total}</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 rounded-full transition-all"
              style={{ width: `${(progress.current / progress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {syncing && progress.total === 0 && progress.label && (
        <p className="text-xs text-muted-foreground">{progress.label}</p>
      )}

      {/* Result message */}
      {result && !syncing && (
        <div className={`flex items-start gap-2 text-xs px-2 py-1.5 rounded ${
          result.success ? "text-green-400" : "text-red-400"
        }`}>
          {result.success ? <Check className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
          <span>{result.message}</span>
        </div>
      )}

      {/* Email triage wizard */}
      {triageItems && (
        <EmailTriageWizard
          items={triageItems}
          isScanning={syncing && scanType === "deep"}
          onComplete={handleTriageComplete}
          onCancel={() => { setTriageItems(null); setSyncing(false); }}
        />
      )}
    </div>
  );
}

