"use client";

import { useState, useTransition } from "react";
import { RefreshCw, CheckCircle2, ExternalLink, Loader2, FlaskConical } from "lucide-react";
import { setQuickBooksEnvironment } from "@/lib/actions/quickbooks";

interface QuickBooksConnectProps {
  isConnected: boolean;
  lastSync: string | null;
  environment?: "sandbox" | "production";
}

export function QuickBooksConnect({ isConnected, lastSync, environment = "production" }: QuickBooksConnectProps) {
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [env, setEnv] = useState<"sandbox" | "production">(environment);
  const [savingEnv, startSaveEnv] = useTransition();

  function changeEnv(next: "sandbox" | "production") {
    if (next === env) return;
    setEnv(next);
    startSaveEnv(async () => {
      const res = await setQuickBooksEnvironment(next);
      if (res?.error) {
        setEnv(env); // revert on failure
        setSyncResult(`Error: ${res.error}`);
      }
    });
  }

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/quickbooks/sync", { method: "POST" });
      const data = await res.json();
      if (data.error) {
        setSyncResult(`Error: ${data.error}`);
      } else {
        const r = data.result;
        setSyncResult(
          `Synced: ${r.vendors.synced} vendors, ${r.bills.synced} bills, ${r.payments.synced} payments, ${r.purchases.synced} purchases` +
          (r.errors.length > 0 ? ` | Errors: ${r.errors.join(", ")}` : "")
        );
      }
    } catch {
      setSyncResult("Sync failed — check console");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Environment toggle — sandbox lets you test writes against a fake
          QuickBooks company before anything touches the real books. Switching
          requires reconnecting so the tokens match the chosen environment. */}
      <div className="flex items-center justify-between rounded-lg border p-3">
        <div className="flex items-center gap-2 text-sm">
          <FlaskConical className="h-4 w-4 text-amber-500" />
          <span className="font-medium">Environment</span>
          {savingEnv && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex items-center gap-1 rounded-md bg-muted p-0.5">
          {(["sandbox", "production"] as const).map((option) => (
            <button
              key={option}
              onClick={() => changeEnv(option)}
              disabled={savingEnv}
              className={`px-3 py-1 rounded text-xs font-medium capitalize transition-colors disabled:opacity-50 ${
                env === option
                  ? option === "sandbox"
                    ? "bg-amber-600 text-white"
                    : "bg-green-600 text-white"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
      {env === "sandbox" && (
        <p className="text-xs text-amber-500">
          Sandbox mode — connect your Intuit test company. Writes go to the sandbox, not your real books.
        </p>
      )}

      {isConnected ? (
        <>
          <div className="flex items-center gap-2 text-green-500">
            <CheckCircle2 className="h-5 w-5" />
            <span className="font-medium">QuickBooks Connected</span>
          </div>
          {lastSync && (
            <p className="text-sm text-muted-foreground">
              Last sync: {new Date(lastSync).toLocaleString()}
            </p>
          )}
          <div className="flex gap-3">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 transition-colors disabled:opacity-50"
            >
              {syncing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {syncing ? "Syncing..." : "Sync Now"}
            </button>
            <a
              href="/api/quickbooks/auth"
              className="flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium hover:bg-muted transition-colors"
            >
              <ExternalLink className="h-4 w-4" />
              Reconnect
            </a>
          </div>
          {syncResult && (
            <div className={`text-sm p-3 rounded-lg ${syncResult.startsWith("Error") ? "bg-red-500/10 text-red-400" : "bg-green-500/10 text-green-400"}`}>
              {syncResult}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Connect your QuickBooks account to automatically sync invoices, payments, and vendor data.
          </p>
          <a
            href="/api/quickbooks/auth"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition-colors"
          >
            <ExternalLink className="h-4 w-4" />
            Connect QuickBooks
          </a>
        </>
      )}
    </div>
  );
}
