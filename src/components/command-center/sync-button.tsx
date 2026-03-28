"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw, Check, AlertCircle, Brain } from "lucide-react";
import { runAIEmailSync } from "@/lib/actions/ai-email-engine";
import { useRouter } from "next/navigation";

export function SyncButton() {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
    details?: string;
  } | null>(null);
  const router = useRouter();

  async function handleSync() {
    setSyncing(true);
    setResult(null);

    try {
      const syncResult = await runAIEmailSync(200);

      const parts: string[] = [];
      if (syncResult.emailsProcessed > 0)
        parts.push(`${syncResult.emailsProcessed} emails`);
      if (syncResult.projectsCreated > 0)
        parts.push(`${syncResult.projectsCreated} projects created`);
      if (syncResult.customersCreated > 0)
        parts.push(`${syncResult.customersCreated} customers created`);
      if (syncResult.quotesCreated > 0)
        parts.push(`${syncResult.quotesCreated} quotes found`);
      if (syncResult.followUpsCreated > 0)
        parts.push(`${syncResult.followUpsCreated} follow-ups`);
      if (syncResult.stagesUpdated > 0)
        parts.push(`${syncResult.stagesUpdated} stages updated`);

      setResult({
        success: true,
        message:
          parts.length > 0
            ? `AI processed: ${parts.join(", ")}`
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
        {syncing ? (
          <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <Brain className="h-4 w-4 mr-2" />
        )}
        {syncing ? "AI Processing Emails..." : "AI Sync Gmail"}
      </Button>
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
