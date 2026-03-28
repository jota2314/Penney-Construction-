"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw, Check, AlertCircle, Brain, Zap, ChevronDown, ChevronUp } from "lucide-react";
import {
  runAIEmailSync,
  clearAllData,
  getNewEmailIds,
  processBatchByIds,
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

function timestamp() {
  return new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function SyncButton() {
  const [syncing, setSyncing] = useState(false);
  const [scanType, setScanType] = useState<"sync" | "deep">("sync");
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  function log(msg: string) {
    setLogs((prev) => [...prev, `[${timestamp()}] ${msg}`]);
  }

  async function handleSync() {
    setSyncing(true);
    setScanType("sync");
    setResult(null);
    setLogs([]);
    setShowLogs(true);

    log("Starting AI Sync...");
    log("Checking for new emails...");

    try {
      const syncResult = await runAIEmailSync(50);
      const parts = formatResult(syncResult);

      log(`Done: ${parts.length > 0 ? parts.join(", ") : "No new emails"}`);
      if (syncResult.errors.length > 0) {
        syncResult.errors.forEach((e) => log(`ERROR: ${e}`));
      }

      setResult({
        success: true,
        message: parts.length > 0 ? `Done: ${parts.join(", ")}` : "No new emails",
      });
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to sync.";
      log(`FATAL ERROR: ${msg}`);
      setResult({ success: false, message: msg });
    } finally {
      setSyncing(false);
    }
  }

  async function handleDeepScan() {
    if (!confirm("Re-sync: Clear email logs, quotes, and follow-ups, then re-scan 200 Gmail emails. Continue?")) return;

    setSyncing(true);
    setScanType("deep");
    setResult(null);
    setLogs([]);
    setShowLogs(true);

    const totals: BatchResult = {
      emailsProcessed: 0, projectsCreated: 0, customersCreated: 0,
      quotesCreated: 0, followUpsCreated: 0, stagesUpdated: 0, errors: [],
    };

    try {
      // Step 1
      log("Step 1: Clearing email logs, quotes, follow-ups...");
      await clearAllData();
      log("Data cleared.");

      // Step 2
      log("Step 2: Fetching email IDs from Gmail...");
      const emailIds = await getNewEmailIds(200);
      log(`Found ${emailIds.length} new emails to process.`);

      if (emailIds.length === 0) {
        log("No emails found. Done.");
        setResult({ success: true, message: "No emails found" });
        setSyncing(false);
        return;
      }

      // Step 3
      const totalBatches = Math.ceil(emailIds.length / 5);
      log(`Step 3: Processing ${emailIds.length} emails in ${totalBatches} batches of 5...`);

      for (let i = 0; i < emailIds.length; i += 5) {
        const batchNum = Math.floor(i / 5) + 1;
        const batchEnd = Math.min(i + 5, emailIds.length);
        const batch = emailIds.slice(i, batchEnd);

        log(`Batch ${batchNum}/${totalBatches}: Analyzing emails ${i + 1}–${batchEnd}...`);

        const r = await processBatchByIds(batch);

        // Log what happened in this batch
        const batchParts: string[] = [];
        if (r.emailsProcessed > 0) batchParts.push(`${r.emailsProcessed} processed`);
        if (r.projectsCreated > 0) batchParts.push(`${r.projectsCreated} projects`);
        if (r.quotesCreated > 0) batchParts.push(`${r.quotesCreated} quotes`);
        if (r.followUpsCreated > 0) batchParts.push(`${r.followUpsCreated} follow-ups`);
        if (r.stagesUpdated > 0) batchParts.push(`${r.stagesUpdated} stages`);

        log(`  → ${batchParts.length > 0 ? batchParts.join(", ") : "no actions"}`);

        if (r.errors.length > 0) {
          r.errors.forEach((e) => log(`  ERROR: ${e}`));
        }

        totals.emailsProcessed += r.emailsProcessed;
        totals.projectsCreated += r.projectsCreated;
        totals.customersCreated += r.customersCreated;
        totals.quotesCreated += r.quotesCreated;
        totals.followUpsCreated += r.followUpsCreated;
        totals.stagesUpdated += r.stagesUpdated;
        totals.errors.push(...r.errors);
      }

      const parts = formatResult(totals);
      log("─────────────────────────────");
      log(`COMPLETE: ${parts.length > 0 ? parts.join(", ") : "No actionable emails"}`);
      if (totals.errors.length > 0) {
        log(`Total errors: ${totals.errors.length}`);
      }

      setResult({
        success: true,
        message: parts.length > 0 ? `Done: ${parts.join(", ")}` : "No actionable emails",
      });
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Deep scan failed.";
      log(`FATAL ERROR: ${msg}`);
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

      {result && (
        <div className={`flex items-start gap-1.5 text-sm ${result.success ? "text-emerald-400" : "text-red-400"}`}>
          {result.success ? <Check className="h-4 w-4 mt-0.5 shrink-0" /> : <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />}
          <p>{result.message}</p>
        </div>
      )}

      {/* Debug Log Panel */}
      {logs.length > 0 && (
        <div className="rounded-lg border bg-black/50 overflow-hidden">
          <button
            onClick={() => setShowLogs(!showLogs)}
            className="w-full flex items-center justify-between px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <span className="font-mono">Debug Log ({logs.length} entries)</span>
            {showLogs ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {showLogs && (
            <div className="max-h-64 overflow-y-auto px-3 pb-3">
              <div className="font-mono text-xs space-y-0.5">
                {logs.map((line, i) => (
                  <div
                    key={i}
                    className={
                      line.includes("ERROR") || line.includes("FATAL")
                        ? "text-red-400"
                        : line.includes("COMPLETE")
                        ? "text-emerald-400"
                        : line.includes("→")
                        ? "text-blue-300"
                        : "text-muted-foreground"
                    }
                  >
                    {line}
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
