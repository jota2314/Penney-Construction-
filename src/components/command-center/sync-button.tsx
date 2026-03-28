"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw, Check, AlertCircle } from "lucide-react";
import { syncGmailInbox } from "@/lib/actions/gmail-sync";
import { useRouter } from "next/navigation";

export function SyncButton() {
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
      const syncResult = await syncGmailInbox();
      setResult({
        success: true,
        message: `Synced ${syncResult.emailsProcessed} emails, found ${syncResult.quotesFound} quotes, matched ${syncResult.projectsMatched} to projects`,
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
    <div className="flex items-center gap-3">
      <Button
        onClick={handleSync}
        disabled={syncing}
        variant="outline"
        className="text-blue-400 border-blue-500/30 hover:bg-blue-500/10"
      >
        <RefreshCw
          className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`}
        />
        {syncing ? "Syncing Gmail..." : "Sync Gmail"}
      </Button>
      {result && (
        <div
          className={`flex items-center gap-1.5 text-sm ${
            result.success ? "text-emerald-400" : "text-red-400"
          }`}
        >
          {result.success ? (
            <Check className="h-4 w-4" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
          {result.message}
        </div>
      )}
    </div>
  );
}
