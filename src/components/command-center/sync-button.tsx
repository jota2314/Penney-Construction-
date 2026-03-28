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
import { ScanReviewDialog } from "./scan-review-dialog";

// ── Types for staged data ──────────────────

export interface StagedProject {
  id: string;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  project_type?: string;
  status?: string;
  phase?: string;
  description?: string;
  estimated_value?: number;
  contract_value?: number;
  scope_of_work?: string;
  required_trades?: string[];
  customer_name?: string;
  approved: boolean;
}

export interface StagedCustomer {
  id: string;
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  approved: boolean;
}

export interface StagedSub {
  id: string;
  company_name: string;
  contact_name?: string;
  email?: string;
  phone?: string;
  trades: string[];
  approved: boolean;
}

export interface StagedQuote {
  id: string;
  subcontractor_name: string;
  project_name: string;
  trade?: string;
  amount?: number;
  status: string;
  scope_description?: string;
  approved: boolean;
}

export interface StagedFollowUp {
  id: string;
  contact_name: string;
  contact_type: string;
  description: string;
  priority: string;
  project_name?: string;
  approved: boolean;
}

export interface ScanDraft {
  projects: StagedProject[];
  customers: StagedCustomer[];
  subs: StagedSub[];
  quotes: StagedQuote[];
  followUps: StagedFollowUp[];
  emailCount: number;
  rawDecisions: unknown[];
  rawEmails: unknown[];
}

// ── Helpers ──────────────────

function formatResult(r: BatchResult) {
  const parts: string[] = [];
  if (r.projectsCreated > 0) parts.push(`${r.projectsCreated} projects`);
  if (r.customersCreated > 0) parts.push(`${r.customersCreated} customers`);
  if (r.subsCreated > 0) parts.push(`${r.subsCreated} subs`);
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
  if (!res.ok) return { decisions: [], emails: [], error: data.error || `HTTP ${res.status}` };
  return data;
}

let idCounter = 0;
function tempId() { return `staged-${++idCounter}`; }

function extractStagedItems(decisions: { email_index: number; actions: { type: string; data: Record<string, unknown> }[] }[], draft: ScanDraft) {
  for (const decision of decisions) {
    for (const action of decision.actions) {
      const d = action.data;
      switch (action.type) {
        case "create_project": {
          const name = (d.name as string)?.trim();
          if (!name) break;
          if (draft.projects.some((p) => p.name.toLowerCase() === name.toLowerCase())) break;
          draft.projects.push({
            id: tempId(), name, address: d.address as string, city: d.city as string,
            state: d.state as string, project_type: d.project_type as string,
            status: d.status as string, phase: d.phase as string,
            description: d.description as string, estimated_value: d.estimated_value as number,
            contract_value: d.contract_value as number, scope_of_work: d.scope_of_work as string,
            required_trades: d.required_trades as string[], customer_name: d.customer_name as string,
            approved: true,
          });
          break;
        }
        case "create_customer": {
          const fn = (d.first_name as string)?.trim();
          const ln = (d.last_name as string)?.trim();
          if (!fn || !ln) break;
          if (draft.customers.some((c) => c.first_name.toLowerCase() === fn.toLowerCase() && c.last_name.toLowerCase() === ln.toLowerCase())) break;
          draft.customers.push({
            id: tempId(), first_name: fn, last_name: ln, email: d.email as string,
            phone: d.phone as string, address: d.address as string, city: d.city as string,
            state: d.state as string, approved: true,
          });
          break;
        }
        case "create_subcontractor": {
          const cn = (d.company_name as string)?.trim();
          if (!cn) break;
          if (draft.subs.some((s) => s.company_name.toLowerCase() === cn.toLowerCase())) break;
          draft.subs.push({
            id: tempId(), company_name: cn, contact_name: d.contact_name as string,
            email: d.email as string, phone: d.phone as string,
            trades: (d.trades as string[]) || [], approved: true,
          });
          break;
        }
        case "create_quote": {
          const sub = (d.subcontractor_name as string)?.trim();
          if (!sub) break;
          draft.quotes.push({
            id: tempId(), subcontractor_name: sub, project_name: (d.project_name as string) || "Unmatched",
            trade: d.trade as string, amount: d.amount as number,
            status: (d.status as string) || "received",
            scope_description: d.scope_description as string, approved: true,
          });
          break;
        }
        case "create_follow_up": {
          const contact = (d.contact_name as string) || "Unknown";
          draft.followUps.push({
            id: tempId(), contact_name: contact, contact_type: (d.contact_type as string) || "other",
            description: (d.description as string) || "", priority: (d.priority as string) || "medium",
            project_name: d.project_name as string, approved: true,
          });
          break;
        }
      }
    }
  }
}

// ── Component ──────────────────

export function SyncButton() {
  const [syncing, setSyncing] = useState(false);
  const [scanType, setScanType] = useState<"sync" | "deep">("sync");
  const [progress, setProgress] = useState({ current: 0, total: 0, label: "" });
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [draft, setDraft] = useState<ScanDraft | null>(null);
  const router = useRouter();

  async function processBatchesForStaging(emailIds: string[], draft: ScanDraft) {
    const batchSize = 50;
    const totalBatches = Math.ceil(emailIds.length / batchSize);
    setProgress({ current: 0, total: totalBatches, label: "Scanning emails..." });

    for (let i = 0; i < emailIds.length; i += batchSize) {
      const batch = emailIds.slice(i, Math.min(i + batchSize, emailIds.length));
      const batchNum = Math.floor(i / batchSize) + 1;
      setProgress({ current: batchNum, total: totalBatches, label: `Analyzing batch ${batchNum}/${totalBatches} (${batch.length} emails)...` });

      const { decisions, emails: emailsData, error } = await analyzeEmailBatch(batch);
      if (error) continue;
      if (!decisions || decisions.length === 0) continue;

      draft.emailCount += emailsData.length;
      draft.rawDecisions.push(...decisions);
      draft.rawEmails.push(...emailsData);

      extractStagedItems(decisions, draft);
    }
  }

  // Quick sync — still saves directly (incremental)
  async function handleSync() {
    setSyncing(true);
    setScanType("sync");
    setResult(null);
    setProgress({ current: 0, total: 0, label: "" });

    const totals: BatchResult = {
      emailsProcessed: 0, projectsCreated: 0, customersCreated: 0, subsCreated: 0,
      quotesCreated: 0, followUpsCreated: 0, stagesUpdated: 0, errors: [],
    };

    try {
      const emailIds = await getNewEmailIds(50);
      if (emailIds.length === 0) {
        setResult({ success: true, message: "No new emails" });
        setSyncing(false);
        return;
      }

      const batchSize = 25;
      const totalBatches = Math.ceil(emailIds.length / batchSize);
      setProgress({ current: 0, total: totalBatches, label: "Syncing..." });

      for (let i = 0; i < emailIds.length; i += batchSize) {
        const batch = emailIds.slice(i, Math.min(i + batchSize, emailIds.length));
        setProgress({ current: Math.floor(i / batchSize) + 1, total: totalBatches, label: `Processing batch...` });
        const { decisions, emails: emailsData, error } = await analyzeEmailBatch(batch);
        if (error) { totals.errors.push(error); continue; }
        if (!decisions || decisions.length === 0) continue;
        const r = await saveBatchResults(decisions, emailsData);
        totals.emailsProcessed += r.emailsProcessed;
        totals.projectsCreated += r.projectsCreated;
        totals.customersCreated += r.customersCreated;
        totals.subsCreated += r.subsCreated;
        totals.quotesCreated += r.quotesCreated;
        totals.followUpsCreated += r.followUpsCreated;
        totals.stagesUpdated += r.stagesUpdated;
        totals.errors.push(...r.errors);
      }

      const parts = formatResult(totals);
      setResult({ success: true, message: parts.length > 0 ? `Done: ${parts.join(", ")}` : "No new data" });
      router.refresh();
    } catch (err) {
      setResult({ success: false, message: err instanceof Error ? err.message : "Failed to sync." });
    } finally {
      setSyncing(false);
    }
  }

  // Deep Scan — builds draft for review
  async function handleDeepScan() {
    if (!confirm("Deep Scan: This will read your last 300 emails and build a draft for you to review before creating anything. Continue?")) return;

    setSyncing(true);
    setScanType("deep");
    setResult(null);
    setProgress({ current: 0, total: 0, label: "Preparing..." });

    const newDraft: ScanDraft = {
      projects: [], customers: [], subs: [], quotes: [], followUps: [],
      emailCount: 0, rawDecisions: [], rawEmails: [],
    };

    try {
      setProgress({ current: 0, total: 0, label: "Fetching email list..." });
      const emailIds = await getNewEmailIds(300);

      if (emailIds.length === 0) {
        setResult({ success: true, message: "No emails found" });
        setSyncing(false);
        return;
      }

      await processBatchesForStaging(emailIds, newDraft);

      setDraft(newDraft);
      setResult({
        success: true,
        message: `Found: ${newDraft.projects.length} projects, ${newDraft.customers.length} customers, ${newDraft.subs.length} subs, ${newDraft.quotes.length} quotes, ${newDraft.followUps.length} follow-ups from ${newDraft.emailCount} emails`,
      });
    } catch (err) {
      setResult({ success: false, message: err instanceof Error ? err.message : "Deep scan failed." });
    } finally {
      setSyncing(false);
    }
  }

  async function handleApprove(approvedDraft: ScanDraft) {
    setSyncing(true);
    setProgress({ current: 0, total: 0, label: "Saving approved data..." });

    try {
      await clearAllData();

      // Build decisions from approved items
      const decisions = buildDecisionsFromDraft(approvedDraft);
      const r = await saveBatchResults(decisions, []);

      setDraft(null);
      setResult({
        success: true,
        message: `Created: ${r.projectsCreated} projects, ${r.customersCreated} customers, ${r.subsCreated} subs, ${r.quotesCreated} quotes, ${r.followUpsCreated} follow-ups`,
      });
      router.refresh();
    } catch (err) {
      setResult({ success: false, message: err instanceof Error ? err.message : "Save failed." });
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
          {syncing && scanType === "deep" ? "Scanning..." : "Deep Scan"}
        </Button>
      </div>

      {/* Progress bar */}
      {syncing && progress.total > 0 && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{progress.label}</span>
            <span>{progress.current}/{progress.total}</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 rounded-full transition-all"
              style={{ width: `${(progress.current / progress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {syncing && progress.total === 0 && progress.label && (
        <p className="text-xs text-muted-foreground">{progress.label}</p>
      )}

      {/* Result message */}
      {result && !syncing && (
        <div className={`flex items-start gap-2 text-xs px-2 py-1.5 rounded ${
          result.success ? "text-green-400" : "text-red-400"
        }`}>
          {result.success ? <Check className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
          <span>{result.message}</span>
        </div>
      )}

      {/* Review dialog */}
      {draft && (
        <ScanReviewDialog
          draft={draft}
          onApprove={handleApprove}
          onCancel={() => setDraft(null)}
        />
      )}
    </div>
  );
}

// Build decisions array from approved draft items
function buildDecisionsFromDraft(draft: ScanDraft): { email_index: number; actions: { type: string; data: Record<string, unknown> }[] }[] {
  const actions: { type: string; data: Record<string, unknown> }[] = [];

  // Customers first
  for (const c of draft.customers.filter((c) => c.approved)) {
    actions.push({ type: "create_customer", data: { first_name: c.first_name, last_name: c.last_name, email: c.email, phone: c.phone, address: c.address, city: c.city, state: c.state } });
  }

  // Subs
  for (const s of draft.subs.filter((s) => s.approved)) {
    actions.push({ type: "create_subcontractor", data: { company_name: s.company_name, contact_name: s.contact_name, email: s.email, phone: s.phone, trades: s.trades } });
  }

  // Projects
  for (const p of draft.projects.filter((p) => p.approved)) {
    actions.push({ type: "create_project", data: { name: p.name, address: p.address, city: p.city, state: p.state, project_type: p.project_type, status: p.status, phase: p.phase, description: p.description, estimated_value: p.estimated_value, contract_value: p.contract_value, scope_of_work: p.scope_of_work, required_trades: p.required_trades, customer_name: p.customer_name } });
  }

  // Quotes
  for (const q of draft.quotes.filter((q) => q.approved)) {
    actions.push({ type: "create_quote", data: { subcontractor_name: q.subcontractor_name, project_name: q.project_name, trade: q.trade, amount: q.amount, status: q.status, scope_description: q.scope_description } });
  }

  // Follow-ups
  for (const f of draft.followUps.filter((f) => f.approved)) {
    actions.push({ type: "create_follow_up", data: { contact_name: f.contact_name, contact_type: f.contact_type, description: f.description, priority: f.priority, project_name: f.project_name } });
  }

  return [{ email_index: 0, actions }];
}
