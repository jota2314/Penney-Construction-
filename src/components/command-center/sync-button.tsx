"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw, Check, AlertCircle, Brain, Zap } from "lucide-react";
import {
  runAIEmailSync,
  clearAllData,
  fetchEmailIds,
  processBatch,
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

export function SyncButton() {
  const [syncing, setSyncing] = useState(false);
  const [scanType, setScanType] = useState<"sync" | "deep">("sync");
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
    details?: string;
  } | null>(null);
  const router = useRouter();

  async function handleSync() {
    setSyncing(true);
    setScanType("sync");
    setResult(null);
    setProgress("Checking for new emails...");

    try {
      const syncResult = await runAIEmailSync(50);
      const parts = formatResult(syncResult);

      setResult({
        success: true,
        message:
          parts.length > 0
            ? `Done: ${parts.join(", ")}`
            : "No new emails to process",
        details:
          syncResult.errors.length > 0
            ? `${syncResult.errors.length} errors`
            : undefined,
      });
      router.refresh();
    } catch (err) {
      setResult({
        success: false,
        message:
          err instanceof Error
            ? err.message
            : "Failed to sync. Make sure Google is connected.",
      });
    } finally {
      setSyncing(false);
      setProgress("");
    }
  }

  async function handleDeepScan() {
    if (
      !confirm(
        "Full Reset: This will DELETE ALL projects, customers, quotes, follow-ups, and rebuild everything from your last 200 Gmail emails using AI. Continue?"
      )
    ) {
      return;
    }

    setSyncing(true);
    setScanType("deep");
    setResult(null);

    const totals: BatchResult = {
      emailsProcessed: 0,
      projectsCreated: 0,
      customersCreated: 0,
      quotesCreated: 0,
      followUpsCreated: 0,
      stagesUpdated: 0,
      errors: [],
      done: false,
      totalEmails: 0,
      processedSoFar: 0,
    };

    try {
      // Step 1: Clear all data
      setProgress("Clearing all data...");
      await clearAllData();

      // Step 2: Fetch emails
      setProgress("Pulling emails from Gmail...");
      const emailIds = await fetchEmailIds(200);
      totals.totalEmails = emailIds.length;

      if (emailIds.length === 0) {
        setResult({
          success: true,
          message: "No emails found to process",
        });
        setSyncing(false);
        setProgress("");
        return;
      }

      // Step 3: Process in batches of 3 (fits in Vercel 60s timeout)
      let index = 0;
      while (index < emailIds.length) {
        setProgress(
          `AI processing emails ${index + 1}-${Math.min(index + 3, emailIds.length)} of ${emailIds.length}...`
        );

        const batchResult = await processBatch(index, 3);
        totals.emailsProcessed += batchResult.emailsProcessed;
        totals.projectsCreated += batchResult.projectsCreated;
        totals.customersCreated += batchResult.customersCreated;
        totals.quotesCreated += batchResult.quotesCreated;
        totals.followUpsCreated += batchResult.followUpsCreated;
        totals.stagesUpdated += batchResult.stagesUpdated;
        totals.errors.push(...batchResult.errors);

        index += 3;
      }

      const parts = formatResult(totals);
      setResult({
        success: true,
        message:
          parts.length > 0
            ? `Deep scan complete: ${parts.join(", ")}`
            : "No actionable emails found",
        details:
          totals.errors.length > 0
            ? `${totals.errors.length} errors`
            : undefined,
      });
      router.refresh();
    } catch (err) {
      setResult({
        success: false,
        message:
          err instanceof Error
            ? err.message
            : "Deep scan failed.",
      });
    } finally {
      setSyncing(false);
      setProgress("");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Button
          onClick={handleSync}
          disabled={syncing}
          variant="outline"
          className="text-blue-400 border-blue-500/30 hover:bg-blue-500/10"
        >
          {syncing && scanType === "sync" ? (
            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Brain className="h-4 w-4 mr-2" />
          )}
          {syncing && scanType === "sync"
            ? "Processing..."
            : "AI Sync Gmail"}
        </Button>
        <Button
          onClick={handleDeepScan}
          disabled={syncing}
          variant="outline"
          className="text-orange-400 border-orange-500/30 hover:bg-orange-500/10"
        >
          {syncing && scanType === "deep" ? (
            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Zap className="h-4 w-4 mr-2" />
          )}
          {syncing && scanType === "deep"
            ? "Scanning..."
            : "Deep Scan (Setup)"}
        </Button>
      </div>
      {progress && (
        <p className="text-sm text-blue-400 animate-pulse">{progress}</p>
      )}
      {result && (
        <div
          className={`flex items-start gap-1.5 text-sm ${
            result.success ? "text-emerald-400" : "text-red-400"
          }`}
        >
          {result.success ? (
            <Check className="h-4 w-4 mt-0.5 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          )}
          <div>
            <p>{result.message}</p>
            {result.details && (
              <p className="text-xs text-muted-foreground">{result.details}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
