"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Brain, Check, AlertCircle } from "lucide-react";
import { saveBatchResults, getNewEmailIds } from "@/lib/actions/ai-email-engine";
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
      const ids = await getNewEmailIds(50);
      let totalQuotes = 0;
      let totalEmails = 0;

      for (let i = 0; i < ids.length; i += 5) {
        const batch = ids.slice(i, i + 5);
        const res = await fetch("/api/analyze-emails", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emailIds: batch }),
        });
        if (!res.ok) continue;
        const { decisions, emails } = await res.json();
        if (decisions && emails) {
          const r = await saveBatchResults(decisions, emails);
          totalQuotes += r.quotesCreated;
          totalEmails += r.emailsProcessed;
        }
      }

      setResult({
        success: true,
        message: `Processed ${totalEmails} emails, ${totalQuotes} quotes found`,
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
