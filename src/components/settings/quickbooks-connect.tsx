"use client";

import { useState } from "react";
import { RefreshCw, CheckCircle2, ExternalLink, Loader2 } from "lucide-react";

interface QuickBooksConnectProps {
  isConnected: boolean;
  lastSync: string | null;
}

export function QuickBooksConnect({ isConnected, lastSync }: QuickBooksConnectProps) {
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

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
