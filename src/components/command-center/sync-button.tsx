"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw, Check, AlertCircle, Brain, Zap } from "lucide-react";
import {
  clearAllData,
  getNewEmailIds,
  saveBatchResults,
  type BatchResult,
} from "@/lib/actions/ai-email-engine";
import { useRouter } from "next/navigation";

function formatResult(r: BatchResult) {
  const parts: string[] = [];
  if (r.projectsCreated > 0) parts.push(`${r.projectsCreated} projects`);
  if (r.customersCreated > 0) parts.push(`${r.customersCreated} customers`);
  if (r.quotesCreated > 0) parts.push(`${r.quotesCreated} quotes`);
  if (r.followUpsCreated > 0) parts.push(`${r.followUpsCreated} follow-ups`);
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

  if (!res.ok) {
    return { decisions: [], emails: [], error: data.error || `HTTP ${res.status}` };
  }

  return data;
}

export function SyncButton() {
  const [syncing, setSyncing] = useState(false);
  const [scanType, setScanType] = useState<"sync" | "deep">("sync");
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const router = useRouter();

  async function processBatches(emailIds: string[], totals: BatchResult) {
    const batchSize = 5;
    const totalBatches = Math.ceil(emailIds.length / batchSize);
    setProgress({ current: 0, total: totalBatches });

    for (let i = 0; i < emailIds.length; i += batchSize) {
      const batch = emailIds.slice(i, Math.min(i + batchSize, emailIds.length));
      setProgress({ current: Math.floor(i / batchSize) + 1, total: totalBatches });

      const { decisions, emails: emailsData, error } = await analyzeEmailBatch(batch);

      if (error) {
        totals.errors.push(error);
        continue;
      }

      if (!decisions || decisions.length === 0) {
        continue;
      }

      const r = await saveBatchResults(decisions, emailsData);

      totals.emailsProcessed += r.emailsProcessed;
      totals.projectsCreated += r.projectsCreated;
      totals.customersCreated += r.customersCreated;
      totals.quotesCreated += r.quotesCreated;
      totals.followUpsCreated += r.followUpsCreated;
      totals.stagesUpdated += r.stagesUpdated;
      totals.errors.push(...r.errors);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setScanType("sync");
    setResult(null);
    setProgress({ current: 0, total: 0 });

    const totals: BatchResult = {
      emailsProcessed: 0, projectsCreated: 0, customersCreated: 0,
      quotesCreated: 0, followUpsCreated: 0, stagesUpdated: 0, errors: [],
    };

    try {
      const emailIds = await getNewEmailIds(50);

      if (emailIds.length === 0) {
        setResult({ success: true, message: "No new emails" });
        setSyncing(false);
        return;
      }

      await processBatches(emailIds, totals);

      const parts = formatResult(totals);

      setResult({
        success: true,
        message: parts.length > 0 ? `Done: ${parts.join(", ")}` : "No new emails",
      });
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to sync.";
      setResult({ success: false, message: msg });
    } finally {
      setSyncing(false);
    }
  }

  async function handleDeepScan() {
    if (!confirm("Full Reset: This will clear ALL data (projects, customers, quotes, follow-ups, emails) and rebuild everything from your Gmail. Continue?")) return;

    setSyncing(true);
    setScanType("deep");
    setResult(null);
    setProgress({ current: 0, total: 0 });

    const totals: BatchResult = {
      emailsProcessed: 0, projectsCreated: 0, customersCreated: 0,
      quotesCreated: 0, followUpsCreated: 0, stagesUpdated: 0, errors: [],
    };

    try {
      await clearAllData();

      const emailIds = await getNewEmailIds(200);

      if (emailIds.length === 0) {
        setResult({ success: true, message: "No emails found" });
        setSyncing(false);
        return;
      }

      await processBatches(emailIds, totals);

      const parts = formatResult(totals);

      setResult({
        success: true,
        message: parts.length > 0 ? `Done: ${parts.join(", ")}` : "No actionable emails",
      });
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Deep scan failed.";
      setResult({ success: false, message: msg });
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
          {syncing && scanType === "deep" ? "Scanning..." : "Deep Scan (Setup)"}
        </Button>
      </div>

      {syncing && progress.total > 0 && (
        <div className="flex flex-col gap-1">
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-amber-500 transition-all duration-500 ease-out"
              style={{ width: `${(progress.current / progress.total) * 100}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Processing batch {progress.current} of {progress.total}...
          </p>
        </div>
      )}

      {result && (
        <div className={`flex items-start gap-1.5 text-sm ${result.success ? "text-emerald-400" : "text-red-400"}`}>
          {result.success ? <Check className="h-4 w-4 mt-0.5 shrink-0" /> : <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />}
          <p>{result.message}</p>
        </div>
      )}

    </div>
  );
}
