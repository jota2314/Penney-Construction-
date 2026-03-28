"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Brain, Check, AlertCircle } from "lucide-react";
import { runAIEmailSync } from "@/lib/actions/ai-email-engine";
import { useRouter } from "next/navigation";

interface ProjectSyncButtonProps {
  projectId: string;
}

export function ProjectSyncButton({ projectId }: ProjectSyncButtonProps) {
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
      // For project-specific sync, we still use the full AI sync
      // It will match emails to this project automatically
      const syncResult = await runAIEmailSync(50);
      setResult({
        success: true,
        message: `Processed ${syncResult.emailsProcessed} emails, ${syncResult.quotesCreated} quotes found`,
      });
      router.refresh();
    } catch (err) {
      setResult({
        success: false,
        message:
          err instanceof Error
            ? err.message
            : "Failed to pull emails.",
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
