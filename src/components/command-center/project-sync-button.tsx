"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Brain, Check, AlertCircle } from "lucide-react";
import { saveBatchResults, getNewEmailIds } from "@/lib/actions/ai-email-engine";
import { useRouter } from "next/navigation";

export function ProjectSyncButton() {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const router = useRouter();

  async function handleSync() {
    setSyncing(true);
    setResult(null);

    try {
      // Store Gmail messages in the canonical inbox before running the legacy
      // AI analysis. Previously this button reported success while the inbox
      // stayed empty because analysis only wrote email_logs.
      const syncResponse = await fetch("/api/fetch-and-store-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 50 }),
      });
      const syncResult = await syncResponse.json();
      if (!syncResponse.ok || syncResult.error) {
        throw new Error(syncResult.error || "Gmail sync failed");
      }

      const ids = await getNewEmailIds(50);
      let totalQuotes = 0;
      let totalEmails = 0;
      const analysisErrors: string[] = [];

      for (let i = 0; i < ids.length; i += 5) {
        const batch = ids.slice(i, i + 5);
        const res = await fetch("/api/analyze-emails", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emailIds: batch }),
        });
        if (!res.ok) {
          const errorData = await res.json().catch(() => null);
          analysisErrors.push(errorData?.error || `Analysis failed (${res.status})`);
          continue;
        }
        const { decisions, emails } = await res.json();
        if (decisions && emails) {
          const r = await saveBatchResults(decisions, emails);
          totalQuotes += r.quotesCreated;
          totalEmails += r.emailsProcessed;
        }
      }

      setResult({
        success: analysisErrors.length === 0,
        message: `${syncResult.message}. AI processed ${totalEmails} emails and found ${totalQuotes} quotes.${analysisErrors.length ? ` ${analysisErrors.length} analysis batch(es) failed: ${analysisErrors[0]}` : ""}`,
      });
      router.refresh();
    } catch (err) {
      setResult({
        success: false,
        message: err instanceof Error ? err.message : "Failed to pull emails.",
      });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        onClick={handleSync}
        disabled={syncing}
        variant="outline"
        className="text-blue-400 border-blue-500/30 hover:bg-blue-500/10"
      >
        <Brain className={`h-4 w-4 mr-2 ${syncing ? "animate-pulse" : ""}`} />
        {syncing ? "AI Processing..." : "AI Pull Emails"}
      </Button>
      {result && (
        <div className={`flex items-center gap-1.5 text-sm ${result.success ? "text-emerald-400" : "text-red-400"}`}>
          {result.success ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {result.message}
        </div>
      )}
    </div>
  );
}
