"use client";

import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Award,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  DollarSign,
  Eye,
  HardHat,
  Loader2,
  Mail,
  MailSearch,
  Pencil,
  Plus,
  Receipt,
  ScanSearch,
  ShieldCheck,
  Trash2,
  Trophy,
  Upload,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/utils";
import { PdfViewer } from "@/components/ui/pdf-viewer";
import { REQUIRED_TRADES } from "@/lib/constants/trade-rate";
import { normalizeTradeKey, tradeKeyLabel } from "@/lib/trade-key";
import {
  awardQuote,
  deleteQuoteRequest,
  quickAddQuote,
  reopenQuote,
  setTradeBudget,
  unawardQuote,
} from "@/lib/actions/sub-awarding";
import { getProjectQuoteSignedUrl } from "@/lib/actions/project-files";
import type { Invoice, ProjectTradeBudget, QuoteRequest, QuoteRequestStatus } from "@/types/database";
import type { LinkedEmail } from "@/components/projects/project-detail-tabs";
import { QuoteSplitDialog } from "./quote-split-dialog";
import { QuoteScanDialog } from "./quote-scan-dialog";
import { QuoteCoverageView } from "@/components/estimates/quote-coverage-view";

// ── Types ────────────────────────────────────────────────────

export interface SubDirectoryEntry {
  id: string;
  company_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  trades: string[] | null;
}

interface ProjectSubsTabProps {
  quotes: QuoteRequest[];
  projectId: string;
  projectName: string;
  projectAddress: string | null;
  linkedEmails: LinkedEmail[];
  budgetLines: { trade: string | null; budgeted_cost: number }[];
  tradeBudgets: ProjectTradeBudget[];
  subDirectory: SubDirectoryEntry[];
  invoices: Invoice[];
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  received: { label: "Received", color: "bg-green-500/15 text-green-500 border-green-500/30" },
  awaiting_reply: { label: "Waiting", color: "bg-amber-500/15 text-amber-500 border-amber-500/30" },
  just_sent: { label: "Sent", color: "bg-blue-500/15 text-blue-500 border-blue-500/30" },
  accepted: { label: "Awarded", color: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30" },
  declined: { label: "Declined", color: "bg-red-500/15 text-red-500 border-red-500/30" },
  in_progress: { label: "In Progress", color: "bg-purple-500/15 text-purple-500 border-purple-500/30" },
  approved: { label: "Bill Approved", color: "bg-cyan-500/15 text-cyan-500 border-cyan-500/30" },
};

const ALL_STATUSES: { value: QuoteRequestStatus; label: string }[] = [
  { value: "just_sent", label: "Sent" },
  { value: "awaiting_reply", label: "Awaiting Reply" },
  { value: "received", label: "Received" },
  { value: "in_progress", label: "In Progress" },
  { value: "accepted", label: "Awarded" },
  { value: "approved", label: "Approved (Bill)" },
  { value: "declined", label: "Declined" },
];

const isAwarded = (q: QuoteRequest) => q.status === "accepted" || q.status === "approved";
const isActive = (q: QuoteRequest) => q.status !== "declined";

/** Loose company-name match: "Mike's Electric LLC" ↔ "Mikes Electric". */
function simplifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(llc|inc|corp|co|ltd|company|construction|contracting)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// ── Component ────────────────────────────────────────────────

export function ProjectSubsTab({
  quotes: initialQuotes,
  projectId,
  projectName,
  projectAddress,
  linkedEmails,
  budgetLines,
  tradeBudgets: initialTradeBudgets,
  subDirectory,
  invoices: initialInvoices,
}: ProjectSubsTabProps) {
  const [quotes, setQuotes] = useState(initialQuotes);
  const [manualBudgets, setManualBudgets] = useState<Record<string, number>>(() =>
    Object.fromEntries(initialTradeBudgets.map((b) => [b.trade, Number(b.budget_amount)]))
  );

  // Row expansion + inline editing (same flow as the old Quotes tab)
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editAmount, setEditAmount] = useState("");
  const [editTrade, setEditTrade] = useState("");
  const [editScope, setEditScope] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editSubName, setEditSubName] = useState("");

  // PDF preview + AI dialogs
  const [loadingQuoteId, setLoadingQuoteId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFilename, setPreviewFilename] = useState("");
  const [splitQuoteId, setSplitQuoteId] = useState<string | null>(null);
  const [scanQuoteId, setScanQuoteId] = useState<string | null>(null);

  // Find-in-emails / upload
  const [promoting, setPromoting] = useState(false);
  const [promoteResult, setPromoteResult] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Invoice upload — files the sub's actual bill against a quote. Target null
  // = the toolbar button: AI matches the vendor to a quote on this board.
  const [subInvoices, setSubInvoices] = useState<Invoice[]>(initialInvoices);
  const [invoiceTargetId, setInvoiceTargetId] = useState<string | null>(null);
  const [invoiceUploadingId, setInvoiceUploadingId] = useState<string | null>(null);
  const [invoiceResults, setInvoiceResults] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [toolbarInvoiceResult, setToolbarInvoiceResult] = useState<{ ok: boolean; text: string } | null>(null);
  const invoiceFileInputRef = useRef<HTMLInputElement>(null);

  const invoicesByQuote = useMemo(() => {
    const map = new Map<string, Invoice[]>();
    for (const inv of subInvoices) {
      if (!inv.quote_request_id) continue;
      const list = map.get(inv.quote_request_id) ?? [];
      list.push(inv);
      map.set(inv.quote_request_id, list);
    }
    return map;
  }, [subInvoices]);

  // Award flow
  const [awardTarget, setAwardTarget] = useState<QuoteRequest | null>(null);
  const [awardDeclineOthers, setAwardDeclineOthers] = useState(true);
  const [awardBusy, setAwardBusy] = useState(false);
  const [awardError, setAwardError] = useState<string | null>(null);
  const [awardedJustNow, setAwardedJustNow] = useState<QuoteRequest | null>(null);

  // Quick add ("easy enter")
  const [addOpen, setAddOpen] = useState(false);
  const [addTradePrefill, setAddTradePrefill] = useState<string | null>(null);

  // Email compose
  const [emailQuote, setEmailQuote] = useState<QuoteRequest | null>(null);
  const [emailTemplate, setEmailTemplate] = useState<TemplateKey>("follow_up");

  // Budget editing
  const [budgetEditKey, setBudgetEditKey] = useState<string | null>(null);
  const [budgetInput, setBudgetInput] = useState("");
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [addBudgetOpen, setAddBudgetOpen] = useState(false);

  // ── Derived: trade groups ──────────────────────────────────

  const estimateBudgetByTrade = useMemo(() => {
    const map: Record<string, number> = {};
    for (const line of budgetLines) {
      const key = normalizeTradeKey(line.trade);
      if (!key) continue;
      map[key] = (map[key] ?? 0) + (Number(line.budgeted_cost) || 0);
    }
    return map;
  }, [budgetLines]);

  const { tradeGroups, noTradeQuotes } = useMemo(() => {
    const groups = new Map<string, QuoteRequest[]>();
    const loose: QuoteRequest[] = [];
    for (const q of quotes) {
      const key = normalizeTradeKey(q.trade);
      if (!key) {
        loose.push(q);
        continue;
      }
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(q);
    }
    const keys = new Set<string>([
      ...groups.keys(),
      ...Object.keys(manualBudgets),
      ...Object.entries(estimateBudgetByTrade)
        .filter(([, v]) => v > 0)
        .map(([k]) => k),
    ]);
    const orderIndex = new Map(REQUIRED_TRADES.map((t, i) => [t.key, i]));
    const sortedKeys = Array.from(keys).sort((a, b) => {
      const ai = orderIndex.get(a) ?? 999;
      const bi = orderIndex.get(b) ?? 999;
      if (ai !== bi) return ai - bi;
      return a.localeCompare(b);
    });
    const result = sortedKeys.map((key) => {
      const tradeQuotes = (groups.get(key) ?? []).slice().sort((a, b) => {
        if (isAwarded(a) !== isAwarded(b)) return isAwarded(a) ? -1 : 1;
        if (isActive(a) !== isActive(b)) return isActive(a) ? -1 : 1;
        const aa = a.amount != null ? Number(a.amount) : Infinity;
        const ba = b.amount != null ? Number(b.amount) : Infinity;
        if (aa !== ba) return aa - ba;
        return new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime();
      });
      const budget = manualBudgets[key] ?? estimateBudgetByTrade[key] ?? 0;
      const awardedTotal = tradeQuotes
        .filter(isAwarded)
        .reduce((s, q) => s + (Number(q.amount) || 0), 0);
      return {
        key,
        label: tradeKeyLabel(key),
        budget,
        hasManualBudget: manualBudgets[key] != null,
        estimateBudget: estimateBudgetByTrade[key] ?? 0,
        quotes: tradeQuotes,
        awardedTotal,
        hasAward: tradeQuotes.some(isAwarded),
      };
    });
    return { tradeGroups: result, noTradeQuotes: loose };
  }, [quotes, manualBudgets, estimateBudgetByTrade]);

  const totals = useMemo(() => {
    const budget = tradeGroups.reduce((s, g) => s + g.budget, 0);
    const awarded = tradeGroups.reduce((s, g) => s + g.awardedTotal, 0) +
      noTradeQuotes.filter(isAwarded).reduce((s, q) => s + (Number(q.amount) || 0), 0);
    const tradesWithAward = tradeGroups.filter((g) => g.hasAward).length;
    return { budget, awarded, remaining: budget - awarded, tradesWithAward, tradeCount: tradeGroups.length };
  }, [tradeGroups, noTradeQuotes]);

  // ── Sub directory lookups ──────────────────────────────────

  function findDirectorySub(q: QuoteRequest): SubDirectoryEntry | null {
    if (q.subcontractor_id) {
      const byId = subDirectory.find((s) => s.id === q.subcontractor_id);
      if (byId) return byId;
    }
    const target = simplifyName(q.subcontractor_name);
    if (!target) return null;
    return (
      subDirectory.find((s) => {
        const name = simplifyName(s.company_name);
        return name === target || name.includes(target) || target.includes(name);
      }) ?? null
    );
  }

  function resolveSubEmail(q: QuoteRequest): string {
    const sub = findDirectorySub(q);
    if (sub?.email) return sub.email;
    if (q.gmail_message_id) {
      const email = linkedEmails.find((e) => e.gmail_message_id === q.gmail_message_id);
      if (email) return email.direction === "outbound" ? email.to_email : email.from_email;
    }
    // Last resort: any linked email whose sender matches the sub's name
    const target = simplifyName(q.subcontractor_name);
    for (const email of linkedEmails) {
      if (email.direction === "outbound") continue;
      if (target && simplifyName(email.from_name || "").includes(target)) return email.from_email;
    }
    return "";
  }

  // ── Attachment helpers (carried over from the Quotes tab) ──

  function findAttachmentPath(q: QuoteRequest): string | null {
    if (q.attachment_storage_path) {
      if (!q.attachment_storage_path.includes("/") && q.gmail_message_id) {
        const email = linkedEmails.find((e) => e.gmail_message_id === q.gmail_message_id);
        if (email?.attachments) {
          const att = (email.attachments as { filename?: string; storage_path?: string | null }[]).find(
            (a) => a.storage_path && (a.filename === q.attachment_storage_path || a.storage_path?.endsWith(q.attachment_storage_path!))
          );
          if (att?.storage_path) return att.storage_path;
        }
        const safeName = q.attachment_storage_path.replace(/[^a-zA-Z0-9._-]/g, "_");
        return `${q.gmail_message_id}/${safeName}`;
      }
      return q.attachment_storage_path;
    }
    if (q.gmail_message_id) {
      const email = linkedEmails.find((e) => e.gmail_message_id === q.gmail_message_id);
      if (email?.attachments) {
        const att = (email.attachments as { filename?: string; storage_path?: string | null }[]).find(
          (a) => a.storage_path && a.filename?.toLowerCase().endsWith(".pdf")
        ) || (email.attachments as { storage_path?: string | null }[]).find((a) => a.storage_path);
        if (att?.storage_path) return att.storage_path;
      }
    }
    const subLower = q.subcontractor_name.toLowerCase();
    for (const email of linkedEmails) {
      if (!email.attachments) continue;
      const text = `${email.subject} ${email.from_name} ${email.from_email}`.toLowerCase();
      if (!text.includes(subLower) && !subLower.split(" ").some((w) => w.length > 3 && text.includes(w))) continue;
      const att = (email.attachments as { filename?: string; storage_path?: string | null }[]).find(
        (a) => a.storage_path && a.filename?.toLowerCase().endsWith(".pdf")
      );
      if (att?.storage_path) return att.storage_path;
    }
    return null;
  }

  function findAttachmentFilename(q: QuoteRequest): string {
    if (q.attachment_storage_path) {
      const parts = q.attachment_storage_path.split("/");
      return parts[parts.length - 1];
    }
    if (q.gmail_message_id) {
      const email = linkedEmails.find((e) => e.gmail_message_id === q.gmail_message_id);
      if (email?.attachments) {
        const att = (email.attachments as { filename?: string; storage_path?: string | null }[]).find(
          (a) => a.storage_path && a.filename?.toLowerCase().endsWith(".pdf")
        );
        if (att?.filename) return att.filename;
      }
    }
    return `${q.subcontractor_name} - Quote.pdf`;
  }

  async function handleViewPdf(q: QuoteRequest) {
    const path = findAttachmentPath(q);
    if (!path) return;
    setLoadingQuoteId(q.id);
    try {
      const result = await getProjectQuoteSignedUrl(projectId, q.id, path);
      if (result.url) {
        setPreviewFilename(findAttachmentFilename(q));
        setPreviewUrl(result.url);
      }
    } finally {
      setLoadingQuoteId(null);
    }
  }

  // ── Quote mutations ────────────────────────────────────────

  function patchQuote(quoteId: string, patch: Partial<QuoteRequest>) {
    setQuotes((prev) => prev.map((q) => (q.id === quoteId ? ({ ...q, ...patch } as QuoteRequest) : q)));
  }

  async function updateStatus(quoteId: string, newStatus: QuoteRequestStatus) {
    const supabase = createClient();
    const updates: Record<string, unknown> = { status: newStatus };
    if (newStatus === "received" || newStatus === "accepted" || newStatus === "approved") {
      updates.received_at = new Date().toISOString();
    }
    const { error } = await supabase.from("quote_requests").update(updates).eq("id", quoteId);
    if (!error) patchQuote(quoteId, updates as Partial<QuoteRequest>);
  }

  async function setQuoteTrade(quoteId: string, trade: string) {
    const supabase = createClient();
    const { error } = await supabase.from("quote_requests").update({ trade }).eq("id", quoteId);
    if (!error) patchQuote(quoteId, { trade });
  }

  function startEditing(q: QuoteRequest) {
    setEditingId(q.id);
    setEditAmount(q.amount != null ? String(q.amount) : "");
    setEditTrade(q.trade || "");
    setEditScope(q.scope_description || "");
    setEditNotes(q.notes || "");
    setEditSubName(q.subcontractor_name);
  }

  async function saveEdits(quoteId: string) {
    setSaving(true);
    const updates: Record<string, unknown> = {
      amount: editAmount ? parseFloat(editAmount) : null,
      trade: editTrade || null,
      scope_description: editScope || null,
      notes: editNotes || null,
      subcontractor_name: editSubName,
    };
    const supabase = createClient();
    const { error } = await supabase.from("quote_requests").update(updates).eq("id", quoteId);
    if (!error) patchQuote(quoteId, updates as Partial<QuoteRequest>);
    setSaving(false);
    setEditingId(null);
  }

  async function handleDelete(q: QuoteRequest) {
    if (!window.confirm(`Delete the ${q.subcontractor_name} quote? This can't be undone.`)) return;
    const { error } = await deleteQuoteRequest(q.id);
    if (error) {
      window.alert(error);
      return;
    }
    setQuotes((prev) => prev.filter((x) => x.id !== q.id));
  }

  // ── Award flow ─────────────────────────────────────────────

  function competingCount(q: QuoteRequest): number {
    const key = normalizeTradeKey(q.trade);
    if (!key) return 0;
    return quotes.filter(
      (r) =>
        r.id !== q.id &&
        normalizeTradeKey(r.trade) === key &&
        ["just_sent", "awaiting_reply", "received", "in_progress"].includes(r.status)
    ).length;
  }

  function openAward(q: QuoteRequest) {
    setAwardTarget(q);
    setAwardDeclineOthers(true);
    setAwardError(null);
  }

  async function confirmAward() {
    if (!awardTarget) return;
    setAwardBusy(true);
    setAwardError(null);
    const { error, declinedIds } = await awardQuote(awardTarget.id, awardDeclineOthers);
    setAwardBusy(false);
    if (error) {
      setAwardError(error);
      return;
    }
    patchQuote(awardTarget.id, { status: "accepted", received_at: awardTarget.received_at ?? new Date().toISOString() });
    for (const id of declinedIds) patchQuote(id, { status: "declined" });
    setAwardedJustNow({ ...awardTarget, status: "accepted" });
    setAwardTarget(null);
  }

  async function handleUnaward(q: QuoteRequest) {
    const { error } = await unawardQuote(q.id);
    if (!error) patchQuote(q.id, { status: "received" });
  }

  async function handleReopen(q: QuoteRequest) {
    const { error } = await reopenQuote(q.id);
    if (!error) patchQuote(q.id, { status: "received" });
  }

  // ── Budget editing ─────────────────────────────────────────

  function startBudgetEdit(key: string, current: number) {
    setBudgetEditKey(key);
    setBudgetInput(current > 0 ? String(current) : "");
  }

  async function saveBudget(key: string) {
    setBudgetSaving(true);
    const amount = budgetInput.trim() === "" ? null : parseFloat(budgetInput);
    const { error } = await setTradeBudget(projectId, key, amount != null && !isNaN(amount) ? amount : null);
    setBudgetSaving(false);
    if (!error) {
      setManualBudgets((prev) => {
        const next = { ...prev };
        if (amount != null && !isNaN(amount)) next[key] = amount;
        else delete next[key];
        return next;
      });
      setBudgetEditKey(null);
    }
  }

  // ── Find in emails / upload (carried over) ─────────────────

  async function handleFindInEmails() {
    setPromoting(true);
    setPromoteResult(null);
    try {
      const res = await fetch("/api/promote-quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const data = await res.json();
      if (data.error) {
        setPromoteResult(`Error: ${data.error}`);
        return;
      }
      setPromoteResult(data.message || "Done");
      if (data.created > 0 || data.backfilled > 0) {
        setTimeout(() => window.location.reload(), 1500);
      }
    } catch {
      setPromoteResult("Failed to scan emails");
    } finally {
      setPromoting(false);
    }
  }

  async function handleUploadQuote(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("projectId", projectId);
      const res = await fetch("/api/upload-quote", { method: "POST", body: formData });
      const data = await res.json();
      if (data.error) {
        setUploadResult(`Error: ${data.error}`);
      } else {
        setUploadResult(`Added: ${data.message}`);
        if (data.quote) {
          setQuotes((prev) => [
            {
              ...data.quote,
              scope_description: data.extracted?.scope_description || null,
              extracted_text: data.extracted?.extracted_text || null,
              document_type: data.extracted?.document_type || "quote",
              sent_at: data.extracted?.date || new Date().toISOString(),
              attachment_storage_path: null,
              gmail_message_id: null,
              subcontractor_id: null,
              received_at: new Date().toISOString(),
              notes: null,
              created_by: null,
            } as QuoteRequest,
            ...prev,
          ]);
        }
      }
    } catch {
      setUploadResult("Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function startInvoiceUpload(q: QuoteRequest) {
    setInvoiceTargetId(q.id);
    invoiceFileInputRef.current?.click();
  }

  async function handleUploadInvoice(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const quoteId = invoiceTargetId;
    if (!file) return;
    setInvoiceUploadingId(quoteId ?? "toolbar");
    if (quoteId) {
      setInvoiceResults((prev) => {
        const next = { ...prev };
        delete next[quoteId];
        return next;
      });
    } else {
      setToolbarInvoiceResult(null);
    }
    const setResult = (ok: boolean, text: string) => {
      if (quoteId) setInvoiceResults((prev) => ({ ...prev, [quoteId]: { ok, text } }));
      else setToolbarInvoiceResult({ ok, text });
    };
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("projectId", projectId);
      if (quoteId) formData.append("quoteId", quoteId);
      const res = await fetch("/api/quote-invoice", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok || data.error) {
        setResult(false, data.error || "Upload failed");
      } else {
        if (data.invoice) {
          setSubInvoices((prev) => [data.invoice as Invoice, ...prev.filter((i) => i.id !== data.invoice.id)]);
        }
        setResult(true, data.message || "Invoice filed");
      }
    } catch {
      setResult(false, "Upload failed");
    } finally {
      setInvoiceUploadingId(null);
      setInvoiceTargetId(null);
      if (invoiceFileInputRef.current) invoiceFileInputRef.current.value = "";
    }
  }

  async function viewInvoiceFile(inv: Invoice) {
    if (!inv.attachment_storage_path) return;
    const supabase = createClient();
    // Subs-tab uploads live in email-attachments; field captures in field-captures.
    for (const bucket of ["email-attachments", "field-captures"]) {
      const { data } = await supabase.storage.from(bucket).createSignedUrl(inv.attachment_storage_path, 3600);
      if (data?.signedUrl) {
        window.open(data.signedUrl, "_blank");
        return;
      }
    }
  }

  // ── Row renderer ───────────────────────────────────────────

  function renderQuoteRow(q: QuoteRequest, opts?: { showTradePicker?: boolean }) {
    const isExpanded = expandedId === q.id;
    const isEditing = editingId === q.id;
    const hasFile = !!findAttachmentPath(q);
    const isLoading = loadingQuoteId === q.id;
    const config = STATUS_CONFIG[q.status] || { label: q.status, color: "bg-muted text-foreground" };
    const awarded = isAwarded(q);
    const declined = q.status === "declined";
    const directorySub = findDirectorySub(q);
    const canAward = !awarded && !declined;
    const isManualEntry = !q.gmail_message_id && !q.attachment_storage_path;
    const quoteInvoices = invoicesByQuote.get(q.id) ?? [];
    const billedTotal = quoteInvoices.reduce((s, inv) => s + (Number(inv.amount) || 0), 0);
    const isInvoiceUploading = invoiceUploadingId === q.id;
    const invoiceResult = invoiceResults[q.id];

    return (
      <div
        key={q.id}
        className={`rounded-xl border bg-card overflow-hidden ${
          awarded ? "border-emerald-500/40 bg-emerald-500/[0.04]" : declined ? "opacity-55" : ""
        }`}
      >
        {/* Header row */}
        <div className="flex items-center gap-2 pl-3 pr-2 py-2.5">
          <button
            type="button"
            onClick={() => {
              setExpandedId(isExpanded ? null : q.id);
              if (isExpanded) setEditingId(null);
            }}
            className="flex flex-1 items-center gap-2.5 min-w-0 text-left"
          >
            <div
              className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${
                awarded ? "bg-emerald-500/15" : "bg-muted"
              }`}
            >
              {awarded ? (
                <Trophy className="h-4.5 w-4.5 text-emerald-500" />
              ) : (
                <HardHat className="h-4.5 w-4.5 text-muted-foreground" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className={`text-sm font-medium truncate ${declined ? "line-through" : ""}`}>
                {q.subcontractor_name}
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Badge variant="outline" className={`text-[9px] px-1 py-0 ${config.color}`}>
                  {config.label}
                </Badge>
                {q.sent_at && <span>{formatDate(q.sent_at)}</span>}
                {quoteInvoices.length > 0 && (
                  <span className="flex items-center gap-0.5 text-cyan-500">
                    · <Receipt className="h-3 w-3" /> {formatCurrency(billedTotal)} billed
                  </span>
                )}
                {directorySub?.phone && (
                  <span className="hidden sm:inline truncate">· {directorySub.phone}</span>
                )}
              </div>
            </div>
            <div
              className={`text-sm font-bold tabular-nums shrink-0 ${
                awarded ? "text-emerald-500" : q.amount != null ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              {q.amount != null ? formatCurrency(Number(q.amount)) : "—"}
            </div>
          </button>

          {/* One-tap actions */}
          <div className="flex items-center gap-1 shrink-0">
            {canAward && (
              <Button
                type="button"
                size="sm"
                className="h-7 px-2 text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => openAward(q)}
              >
                <Trophy className="h-3 w-3 sm:mr-1" />
                <span className="hidden sm:inline">Award</span>
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 w-7 p-0"
              title="Email sub"
              onClick={() => {
                setEmailTemplate(awarded ? "award" : q.amount != null ? "follow_up" : "request_quote");
                setEmailQuote(q);
              }}
            >
              <Mail className="h-3.5 w-3.5" />
            </Button>
            <button
              type="button"
              onClick={() => {
                setExpandedId(isExpanded ? null : q.id);
                if (isExpanded) setEditingId(null);
              }}
              className="p-1 text-muted-foreground"
            >
              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Trade picker for unassigned quotes */}
        {opts?.showTradePicker && (
          <div className="flex items-center gap-2 px-3 pb-2.5">
            <span className="text-[11px] text-muted-foreground">Trade:</span>
            <Select value="" onValueChange={(v) => setQuoteTrade(q.id, v)}>
              <SelectTrigger className="h-7 w-auto text-xs gap-1">
                <SelectValue placeholder="Pick a trade" />
              </SelectTrigger>
              <SelectContent>
                {REQUIRED_TRADES.map((t) => (
                  <SelectItem key={t.key} value={t.label} className="text-xs">
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Expanded detail */}
        {isExpanded && !isEditing && (
          <div className="px-4 pb-4 pt-2 border-t space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
              {q.trade && (
                <div>
                  <span className="text-muted-foreground">Trade:</span>{" "}
                  <span className="capitalize">{q.trade}</span>
                </div>
              )}
              {directorySub?.email && (
                <div className="truncate">
                  <span className="text-muted-foreground">Email:</span>{" "}
                  <span>{directorySub.email}</span>
                </div>
              )}
              {directorySub?.phone && (
                <div>
                  <span className="text-muted-foreground">Phone:</span>{" "}
                  <a href={`tel:${directorySub.phone}`} className="text-amber-500 font-medium">
                    {directorySub.phone}
                  </a>
                </div>
              )}
              {q.document_type && q.document_type !== "quote" && (
                <div>
                  <span className="text-muted-foreground">Type:</span>{" "}
                  <span className="capitalize">{q.document_type.replace(/_/g, " ")}</span>
                </div>
              )}
              {q.sent_at && (
                <div>
                  <span className="text-muted-foreground">Date:</span> {formatDate(q.sent_at)}
                </div>
              )}
            </div>

            {q.scope_description && (
              <div className="text-xs">
                <span className="text-muted-foreground">Scope:</span> {q.scope_description}
              </div>
            )}

            {q.extracted_text && (
              <div className="rounded-lg bg-muted/50 p-3 text-xs max-h-40 overflow-y-auto whitespace-pre-wrap font-mono">
                {q.extracted_text}
              </div>
            )}

            {q.notes && (
              <div className="text-xs">
                <span className="text-muted-foreground">Notes:</span> {q.notes}
              </div>
            )}

            {/* Invoices filed against this quote */}
            {quoteInvoices.length > 0 && (
              <div className="rounded-lg border border-cyan-500/20 overflow-hidden">
                <div className="flex items-center justify-between gap-2 bg-cyan-500/[0.06] px-3 py-1.5 text-[11px] font-semibold text-cyan-500">
                  <span className="flex items-center gap-1">
                    <Receipt className="h-3 w-3" /> Invoices
                  </span>
                  <span className="tabular-nums">
                    {formatCurrency(billedTotal)}
                    {q.amount != null && ` of ${formatCurrency(Number(q.amount))}`} billed
                  </span>
                </div>
                <div className="divide-y divide-border/60">
                  {quoteInvoices.map((inv) => (
                    <div key={inv.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                      <div className="flex-1 min-w-0">
                        <div className="truncate">
                          {inv.invoice_number ? `#${inv.invoice_number} — ` : ""}
                          {inv.description || "Invoice"}
                        </div>
                        {inv.invoice_date && (
                          <div className="text-[10px] text-muted-foreground">{formatDate(inv.invoice_date)}</div>
                        )}
                      </div>
                      <Badge
                        variant="outline"
                        className={`text-[9px] px-1 py-0 shrink-0 ${
                          inv.payment_status === "paid"
                            ? "bg-emerald-500/15 text-emerald-500 border-emerald-500/30"
                            : inv.payment_status === "partial"
                              ? "bg-amber-500/15 text-amber-500 border-amber-500/30"
                              : "text-muted-foreground"
                        }`}
                      >
                        {inv.payment_status === "paid" ? "Paid" : inv.payment_status === "partial" ? "Partial" : "Unpaid"}
                      </Badge>
                      <span className="font-semibold tabular-nums shrink-0">{formatCurrency(Number(inv.amount))}</span>
                      {inv.attachment_storage_path && (
                        <button
                          type="button"
                          onClick={() => viewInvoiceFile(inv)}
                          className="p-1 text-muted-foreground hover:text-foreground shrink-0"
                          title="View invoice"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2 pt-1 flex-wrap">
              {hasFile && (
                <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleViewPdf(q)} disabled={isLoading}>
                  {isLoading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Eye className="h-3 w-3 mr-1" />}
                  View PDF
                </Button>
              )}
              <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => startEditing(q)}>
                <Pencil className="h-3 w-3 mr-1" /> Edit
              </Button>

              <Select value={q.status} onValueChange={(v) => updateStatus(q.id, v as QuoteRequestStatus)}>
                <SelectTrigger className="h-7 w-auto text-xs gap-1">
                  <span>Status</span>
                </SelectTrigger>
                <SelectContent>
                  {ALL_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value} className="text-xs">
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {!declined && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
                  onClick={() => startInvoiceUpload(q)}
                  disabled={isInvoiceUploading}
                >
                  {isInvoiceUploading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Receipt className="h-3 w-3 mr-1" />}
                  {isInvoiceUploading ? "AI reading..." : "Upload Invoice"}
                </Button>
              )}

              {q.status !== "approved" && q.status !== "declined" && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
                  onClick={() => setScanQuoteId(q.id)}
                >
                  <ScanSearch className="h-3 w-3 mr-1" /> Scan & Link
                </Button>
              )}
              {q.status !== "approved" && q.status !== "declined" && (
                <Button
                  type="button"
                  size="sm"
                  className="h-7 text-xs bg-cyan-600 hover:bg-cyan-700 text-white"
                  onClick={() => setSplitQuoteId(q.id)}
                >
                  <CheckCircle className="h-3 w-3 mr-1" /> Approve as Bill
                </Button>
              )}
              {q.status === "accepted" && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                  onClick={() => handleUnaward(q)}
                >
                  Un-award
                </Button>
              )}
              {q.status !== "approved" && q.status !== "declined" && q.status !== "accepted" && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10"
                  onClick={() => updateStatus(q.id, "declined")}
                >
                  <X className="h-3 w-3 mr-1" /> Decline
                </Button>
              )}
              {declined && (
                <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleReopen(q)}>
                  Reopen
                </Button>
              )}
              {q.status === "approved" && (
                <>
                  <Badge className="text-[10px] bg-cyan-500/15 text-cyan-500 border-cyan-500/30 gap-1">
                    <ShieldCheck className="h-3 w-3" /> Committed Expense
                  </Badge>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                    onClick={() => updateStatus(q.id, "received")}
                  >
                    Uncommit
                  </Button>
                </>
              )}
              {isManualEntry && q.status !== "approved" && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-red-400 hover:bg-red-500/10"
                  onClick={() => handleDelete(q)}
                >
                  <Trash2 className="h-3 w-3 mr-1" /> Delete
                </Button>
              )}
            </div>

            {invoiceResult && (
              <p className={`text-xs ${invoiceResult.ok ? "text-green-400" : "text-red-400"}`}>
                {invoiceResult.text}
              </p>
            )}
          </div>
        )}

        {/* Inline editing form */}
        {isExpanded && isEditing && (
          <div className="px-4 pb-4 pt-2 border-t space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-muted-foreground font-medium uppercase">Subcontractor</label>
                <Input value={editSubName} onChange={(e) => setEditSubName(e.target.value)} className="h-8 text-sm mt-1" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground font-medium uppercase">Amount ($)</label>
                <Input type="number" step="0.01" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} placeholder="0.00" className="h-8 text-sm mt-1" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground font-medium uppercase">Trade</label>
                <Input value={editTrade} onChange={(e) => setEditTrade(e.target.value)} placeholder="e.g. Plumbing, Electrical" className="h-8 text-sm mt-1" />
              </div>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground font-medium uppercase">Scope Description</label>
              <Textarea value={editScope} onChange={(e) => setEditScope(e.target.value)} placeholder="What's included..." className="text-sm mt-1 min-h-[60px]" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground font-medium uppercase">Notes</label>
              <Textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="Internal notes..." className="text-sm mt-1 min-h-[40px]" />
            </div>
            {q.extracted_text && (
              <details className="text-xs">
                <summary className="text-muted-foreground cursor-pointer hover:text-foreground">Extracted PDF text (reference)</summary>
                <div className="rounded-lg bg-muted/50 p-3 max-h-32 overflow-y-auto whitespace-pre-wrap font-mono mt-1">
                  {q.extracted_text}
                </div>
              </details>
            )}
            <div className="flex items-center gap-2 pt-1">
              <Button size="sm" className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white" onClick={() => saveEdits(q.id)} disabled={saving}>
                {saving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Check className="h-3 w-3 mr-1" />}
                Save Changes
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingId(null)}>
                <X className="h-3 w-3 mr-1" /> Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Quick actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <input ref={fileInputRef} type="file" accept=".pdf,image/*" className="hidden" onChange={handleUploadQuote} />
        <input ref={invoiceFileInputRef} type="file" accept=".pdf,image/*" className="hidden" onChange={handleUploadInvoice} />
        <Button
          onClick={() => {
            setAddTradePrefill(null);
            setAddOpen(true);
          }}
          size="sm"
          className="bg-amber-600 hover:bg-amber-700 text-white"
        >
          <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Sub Quote
        </Button>
        <Button onClick={handleFindInEmails} disabled={promoting} size="sm" variant="outline">
          {promoting ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <MailSearch className="h-3.5 w-3.5 mr-1.5" />}
          {promoting ? "Scanning emails..." : "Find quotes in emails"}
        </Button>
        <Button onClick={() => fileInputRef.current?.click()} disabled={uploading} variant="outline" size="sm">
          {uploading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1.5" />}
          {uploading ? "AI reading..." : "Upload Quote"}
        </Button>
        <Button
          onClick={() => {
            setInvoiceTargetId(null);
            invoiceFileInputRef.current?.click();
          }}
          disabled={invoiceUploadingId === "toolbar"}
          variant="outline"
          size="sm"
          className="border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
        >
          {invoiceUploadingId === "toolbar" ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : (
            <Receipt className="h-3.5 w-3.5 mr-1.5" />
          )}
          {invoiceUploadingId === "toolbar" ? "AI reading..." : "Upload Invoice"}
        </Button>
        {promoteResult && (
          <span className={`text-xs ${promoteResult.startsWith("Error") ? "text-red-400" : "text-green-400"}`}>{promoteResult}</span>
        )}
        {uploadResult && (
          <span className={`text-xs ${uploadResult.startsWith("Error") ? "text-red-400" : "text-green-400"}`}>{uploadResult}</span>
        )}
        {toolbarInvoiceResult && (
          <span className={`text-xs ${toolbarInvoiceResult.ok ? "text-green-400" : "text-red-400"}`}>{toolbarInvoiceResult.text}</span>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border bg-card p-3">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Sub Budget</div>
          <div className="text-lg font-bold mt-0.5 tabular-nums">{formatCurrency(totals.budget)}</div>
        </div>
        <div className="rounded-xl border bg-card p-3">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Awarded</div>
          <div className="text-lg font-bold text-emerald-500 mt-0.5 tabular-nums">{formatCurrency(totals.awarded)}</div>
        </div>
        <div className="rounded-xl border bg-card p-3">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Budget Left</div>
          <div className={`text-lg font-bold mt-0.5 tabular-nums ${totals.remaining < 0 ? "text-red-500" : "text-foreground"}`}>
            {formatCurrency(totals.remaining)}
          </div>
        </div>
        <div className="rounded-xl border bg-card p-3">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Trades Awarded</div>
          <div className="text-lg font-bold mt-0.5 tabular-nums">
            {totals.tradesWithAward}<span className="text-muted-foreground font-medium text-sm"> / {totals.tradeCount}</span>
          </div>
        </div>
      </div>

      {/* Quotes that still need a trade */}
      {noTradeQuotes.length > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-500">
            <HardHat className="h-3.5 w-3.5" />
            {noTradeQuotes.length} quote{noTradeQuotes.length !== 1 ? "s" : ""} need a trade — pick one so they land on the board
          </div>
          {noTradeQuotes.map((q) => renderQuoteRow(q, { showTradePicker: true }))}
        </div>
      )}

      {/* Trade board */}
      {tradeGroups.length === 0 && noTradeQuotes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <HardHat className="h-12 w-12 text-muted-foreground/30 mb-3" />
          <h3 className="font-medium text-muted-foreground">No sub quotes for {projectName} yet</h3>
          <p className="text-sm text-muted-foreground/70 mt-1 max-w-sm">
            Type one in with Add Sub Quote, pull them from project emails, or upload a PDF.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {tradeGroups.map((g) => {
            const variance = g.budget > 0 && g.awardedTotal > 0 ? g.budget - g.awardedTotal : null;
            const lowQuote = g.quotes.filter((q) => isActive(q) && q.amount != null)[0];
            return (
              <div key={g.key} className={`rounded-2xl border bg-card overflow-hidden ${g.hasAward ? "border-emerald-500/25" : ""}`}>
                {/* Trade header */}
                <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-bold truncate">{g.label}</span>
                    {g.hasAward ? (
                      <Badge className="text-[9px] bg-emerald-500/15 text-emerald-500 border-emerald-500/30 gap-0.5">
                        <Trophy className="h-2.5 w-2.5" /> Awarded
                      </Badge>
                    ) : g.quotes.filter(isActive).length > 0 ? (
                      <Badge variant="outline" className="text-[9px] text-muted-foreground">
                        {g.quotes.filter(isActive).length} quote{g.quotes.filter(isActive).length !== 1 ? "s" : ""}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[9px] text-red-400 border-red-500/30">No quotes</Badge>
                    )}
                  </div>

                  {/* Budget (tap to edit) */}
                  {budgetEditKey === g.key ? (
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="number"
                        step="100"
                        value={budgetInput}
                        onChange={(e) => setBudgetInput(e.target.value)}
                        placeholder="Budget $"
                        className="h-7 w-28 text-xs"
                        autoFocus
                      />
                      <Button size="sm" className="h-7 px-2 text-xs bg-green-600 hover:bg-green-700 text-white" onClick={() => saveBudget(g.key)} disabled={budgetSaving}>
                        {budgetSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 px-1.5 text-xs" onClick={() => setBudgetEditKey(null)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => startBudgetEdit(g.key, g.budget)}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground shrink-0"
                      title={g.hasManualBudget ? "PM budget (tap to change)" : g.estimateBudget > 0 ? "From estimate (tap to override)" : "Set a budget"}
                    >
                      <span className="uppercase text-[9px] font-medium tracking-wider">Budget</span>
                      <span className={`font-bold tabular-nums ${g.budget > 0 ? "text-foreground" : ""}`}>
                        {g.budget > 0 ? formatCurrency(g.budget) : "Set"}
                      </span>
                      <Pencil className="h-3 w-3" />
                    </button>
                  )}
                </div>

                {/* Budget vs awarded strip */}
                {(g.awardedTotal > 0 || (g.budget > 0 && lowQuote)) && (
                  <div className="flex items-center gap-2 px-4 pb-2 text-[11px] flex-wrap">
                    {g.awardedTotal > 0 && (
                      <span className="text-emerald-500 font-semibold tabular-nums">
                        Awarded {formatCurrency(g.awardedTotal)}
                      </span>
                    )}
                    {variance != null && (
                      <Badge
                        className={`text-[9px] tabular-nums ${
                          variance >= 0
                            ? "bg-emerald-500/15 text-emerald-500 border-emerald-500/30"
                            : "bg-red-500/15 text-red-500 border-red-500/30"
                        }`}
                      >
                        {variance >= 0
                          ? `${formatCurrency(variance)} under budget`
                          : `${formatCurrency(-variance)} over budget`}
                      </Badge>
                    )}
                    {g.awardedTotal === 0 && g.budget > 0 && lowQuote?.amount != null && (
                      <span className="text-muted-foreground tabular-nums">
                        Low quote {formatCurrency(Number(lowQuote.amount))}{" "}
                        {Number(lowQuote.amount) <= g.budget ? "· in budget" : "· over budget"}
                      </span>
                    )}
                  </div>
                )}

                {/* Quotes in this trade */}
                <div className="space-y-2 px-3 pb-3">
                  {g.quotes.map((q) => renderQuoteRow(q))}
                  <button
                    type="button"
                    onClick={() => {
                      setAddTradePrefill(g.key);
                      setAddOpen(true);
                    }}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed py-2 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add {g.label} quote
                  </button>
                </div>
              </div>
            );
          })}

          {/* Add a trade to the board */}
          <button
            type="button"
            onClick={() => setAddBudgetOpen(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed py-3 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
          >
            <Plus className="h-4 w-4" /> Add trade budget
          </button>
        </div>
      )}

      {/* Estimate line coverage (advanced) */}
      <details className="rounded-2xl border bg-card px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
          Estimate line coverage
        </summary>
        <div className="pt-3">
          <QuoteCoverageView projectId={projectId} projectName={projectName} />
        </div>
      </details>

      {/* ── Dialogs ── */}

      <QuickAddQuoteDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        projectId={projectId}
        projectName={projectName}
        tradePrefill={addTradePrefill}
        subDirectory={subDirectory}
        onCreated={(q) => setQuotes((prev) => [q, ...prev])}
      />

      <SubEmailDialog
        quote={emailQuote}
        template={emailTemplate}
        onTemplateChange={setEmailTemplate}
        onClose={() => setEmailQuote(null)}
        projectId={projectId}
        projectName={projectName}
        projectAddress={projectAddress}
        defaultTo={emailQuote ? resolveSubEmail(emailQuote) : ""}
        contactName={emailQuote ? (findDirectorySub(emailQuote)?.contact_name ?? null) : null}
        onSent={(quoteId) => {
          const q = quotes.find((x) => x.id === quoteId);
          if (q && q.status === "just_sent") patchQuote(quoteId, { status: "awaiting_reply" });
        }}
      />

      <AddTradeBudgetDialog
        open={addBudgetOpen}
        onOpenChange={setAddBudgetOpen}
        existingKeys={tradeGroups.map((g) => g.key)}
        onSave={async (tradeKey, amount) => {
          const { error } = await setTradeBudget(projectId, tradeKey, amount);
          if (!error) setManualBudgets((prev) => ({ ...prev, [normalizeTradeKey(tradeKey)]: amount }));
          return error;
        }}
      />

      {/* Award confirm */}
      <Dialog open={!!awardTarget} onOpenChange={(open) => !open && setAwardTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-emerald-500" /> Award this sub
            </DialogTitle>
            <DialogDescription>
              {awardTarget?.subcontractor_name}
              {awardTarget?.trade ? ` — ${tradeKeyLabel(normalizeTradeKey(awardTarget.trade))}` : ""}
              {awardTarget?.amount != null ? ` at ${formatCurrency(Number(awardTarget.amount))}` : " (no amount entered yet)"}
            </DialogDescription>
          </DialogHeader>
          {awardTarget && competingCount(awardTarget) > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={awardDeclineOthers}
                onChange={(e) => setAwardDeclineOthers(e.target.checked)}
                className="h-4 w-4 accent-emerald-600"
              />
              Decline the other {competingCount(awardTarget)} quote{competingCount(awardTarget) !== 1 ? "s" : ""} for this trade
            </label>
          )}
          {awardError && <p className="text-sm text-red-400">{awardError}</p>}
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setAwardTarget(null)}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={confirmAward} disabled={awardBusy}>
              {awardBusy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Trophy className="h-4 w-4 mr-1.5" />}
              Award
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Post-award: offer the award email */}
      <Dialog open={!!awardedJustNow} onOpenChange={(open) => !open && setAwardedJustNow(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Award className="h-5 w-5 text-emerald-500" /> Awarded!
            </DialogTitle>
            <DialogDescription>
              {awardedJustNow?.subcontractor_name} is your{" "}
              {awardedJustNow?.trade ? tradeKeyLabel(normalizeTradeKey(awardedJustNow.trade)) : ""} sub. Want to let them know?
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setAwardedJustNow(null)}>Not now</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => {
                const q = awardedJustNow;
                setAwardedJustNow(null);
                if (q) {
                  setEmailTemplate("award");
                  setEmailQuote({ ...q, status: "accepted" });
                }
              }}
            >
              <Mail className="h-4 w-4 mr-1.5" /> Send award email
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {previewUrl && (
        <PdfViewer url={previewUrl} filename={previewFilename} onClose={() => setPreviewUrl(null)} />
      )}

      {splitQuoteId && (() => {
        const q = quotes.find((q) => q.id === splitQuoteId);
        if (!q) return null;
        return (
          <QuoteSplitDialog
            quoteId={q.id}
            projectId={projectId}
            quoteName={`${q.subcontractor_name} — ${q.trade || "General"}`}
            quoteAmount={Number(q.amount) || 0}
            onClose={() => setSplitQuoteId(null)}
            onComplete={() => {
              setSplitQuoteId(null);
              patchQuote(q.id, { status: "approved" });
            }}
          />
        );
      })()}

      {scanQuoteId && (() => {
        const q = quotes.find((q) => q.id === scanQuoteId);
        if (!q) return null;
        return (
          <QuoteScanDialog
            quoteId={q.id}
            projectId={projectId}
            quoteName={`${q.subcontractor_name} — ${q.trade || "General"}`}
            quoteAmount={Number(q.amount) || 0}
            onClose={() => setScanQuoteId(null)}
            onComplete={() => {
              setScanQuoteId(null);
              window.location.reload();
            }}
          />
        );
      })()}
    </div>
  );
}

// ── Quick add dialog ("easy enter") ──────────────────────────

function QuickAddQuoteDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
  tradePrefill,
  subDirectory,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
  tradePrefill: string | null;
  subDirectory: SubDirectoryEntry[];
  onCreated: (q: QuoteRequest) => void;
}) {
  const [name, setName] = useState("");
  const [subId, setSubId] = useState<string | null>(null);
  const [trade, setTrade] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [prevPrefill, setPrevPrefill] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(false);

  // Reset the form each time the dialog opens (and apply the trade prefill)
  if (open && !wasOpen) {
    setWasOpen(true);
    setName("");
    setSubId(null);
    setAmount("");
    setNotes("");
    setError(null);
    setTrade(tradePrefill ?? "");
    setPrevPrefill(tradePrefill);
  } else if (!open && wasOpen) {
    setWasOpen(false);
  } else if (open && tradePrefill !== prevPrefill) {
    setPrevPrefill(tradePrefill);
    setTrade(tradePrefill ?? "");
  }

  const suggestions = useMemo(() => {
    const s = name.trim().toLowerCase();
    if (s.length < 2) return [];
    return subDirectory
      .filter(
        (sub) =>
          sub.company_name.toLowerCase().includes(s) ||
          (sub.contact_name ?? "").toLowerCase().includes(s)
      )
      .slice(0, 6);
  }, [name, subDirectory]);

  const selectedSub = subId ? subDirectory.find((s) => s.id === subId) : null;

  async function submit() {
    if (!name.trim()) {
      setError("Who's the sub?");
      return;
    }
    setBusy(true);
    setError(null);
    const parsed = amount.trim() === "" ? null : parseFloat(amount.replace(/[$,]/g, ""));
    const { error: err, quote } = await quickAddQuote({
      projectId,
      projectName,
      subcontractorName: name,
      subcontractorId: subId,
      trade: trade ? tradeKeyLabel(normalizeTradeKey(trade)) : null,
      amount: parsed != null && !isNaN(parsed) ? parsed : null,
      notes: notes || null,
    });
    setBusy(false);
    if (err || !quote) {
      setError(err || "Failed to save");
      return;
    }
    onCreated(quote);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-amber-500" /> Add Sub Quote
          </DialogTitle>
          <DialogDescription>
            Got a number by phone or text? Type it in — done in ten seconds.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="relative">
            <label className="text-[10px] text-muted-foreground font-medium uppercase">Subcontractor *</label>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setSubId(null);
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              placeholder="Company or name"
              className="h-9 text-sm mt-1"
            />
            {showSuggestions && suggestions.length > 0 && !subId && (
              <div className="absolute z-50 mt-1 w-full rounded-lg border bg-popover shadow-md overflow-hidden">
                {suggestions.map((sub) => (
                  <button
                    key={sub.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setName(sub.company_name);
                      setSubId(sub.id);
                      setShowSuggestions(false);
                      if (!trade && sub.trades?.length) {
                        const key = normalizeTradeKey(sub.trades[0]);
                        if (REQUIRED_TRADES.some((t) => t.key === key)) setTrade(key);
                      }
                    }}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                  >
                    <span className="truncate">{sub.company_name}</span>
                    <span className="text-[10px] text-muted-foreground truncate shrink-0">
                      {sub.trades?.slice(0, 2).join(", ")}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {selectedSub && (
              <p className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                <Check className="h-3 w-3 text-emerald-500" />
                In directory{selectedSub.email ? ` · ${selectedSub.email}` : ""}
                {selectedSub.phone ? ` · ${selectedSub.phone}` : ""}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-muted-foreground font-medium uppercase">Trade</label>
              <Select value={trade} onValueChange={setTrade}>
                <SelectTrigger className="h-9 text-sm mt-1 w-full">
                  <SelectValue placeholder="Pick trade" />
                </SelectTrigger>
                <SelectContent>
                  {REQUIRED_TRADES.map((t) => (
                    <SelectItem key={t.key} value={t.key} className="text-sm">
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground font-medium uppercase">Amount ($)</label>
              <Input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="12,500"
                className="h-9 text-sm mt-1"
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] text-muted-foreground font-medium uppercase">Notes</label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Includes fixtures, 2-week lead time..."
              className="text-sm mt-1 min-h-[50px]"
            />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button className="bg-amber-600 hover:bg-amber-700 text-white" onClick={submit} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Plus className="h-4 w-4 mr-1.5" />}
              Save Quote
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Email dialog ─────────────────────────────────────────────

type TemplateKey = "award" | "follow_up" | "request_quote" | "custom";

const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  award: "Award notice",
  follow_up: "Follow up",
  request_quote: "Request quote",
  custom: "Blank",
};

function buildTemplate(
  key: TemplateKey,
  q: QuoteRequest,
  projectName: string,
  projectAddress: string | null,
  contactName: string | null
): { subject: string; body: string } {
  const tradeLabel = q.trade ? tradeKeyLabel(normalizeTradeKey(q.trade)) : "your trade";
  const where = projectAddress ? `${projectName} (${projectAddress})` : projectName;
  const hi = `Hi ${contactName?.split(" ")[0] || "there"},`;
  const amount = q.amount != null ? formatCurrency(Number(q.amount)) : null;

  switch (key) {
    case "award":
      return {
        subject: `You're awarded — ${tradeLabel} at ${projectName}`,
        body: `${hi}\n\nGood news — we'd like to move forward with ${q.subcontractor_name} for the ${tradeLabel.toLowerCase()} work at ${where}.${amount ? `\n\nContract amount per your quote: ${amount}.` : ""}\n\nReply here to confirm, and let us know your current lead time so we can get you on the schedule. We'll follow up with paperwork and start dates.\n\nThanks,`,
      };
    case "follow_up":
      return {
        subject: `Following up — ${tradeLabel} quote for ${projectName}`,
        body: `${hi}\n\nJust checking in on your ${tradeLabel.toLowerCase()} quote for ${where}.${amount ? ` We have your number at ${amount} — is that still good?` : " Were you able to put a number together?"}\n\nAnything you need from us — plans, a walkthrough, scope questions — just reply here.\n\nThanks,`,
      };
    case "request_quote":
      return {
        subject: `Quote request — ${tradeLabel} at ${projectName}`,
        body: `${hi}\n\nWe're pricing the ${tradeLabel.toLowerCase()} work at ${where} and would like a number from you.\n\nReply here and we'll get you plans and scope details, or set up a site walk if that's easier.\n\nThanks,`,
      };
    default:
      return { subject: `${projectName} — ${tradeLabel}`, body: `${hi}\n\n` };
  }
}

function SubEmailDialog({
  quote,
  template,
  onTemplateChange,
  onClose,
  projectId,
  projectName,
  projectAddress,
  defaultTo,
  contactName,
  onSent,
}: {
  quote: QuoteRequest | null;
  template: TemplateKey;
  onTemplateChange: (t: TemplateKey) => void;
  onClose: () => void;
  projectId: string;
  projectName: string;
  projectAddress: string | null;
  defaultTo: string;
  contactName: string | null;
  onSent: (quoteId: string) => void;
}) {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loadedForKey, setLoadedForKey] = useState<string | null>(null);

  // Re-seed the form whenever a different quote or template comes in
  const seedKey = quote ? `${quote.id}:${template}` : null;
  if (quote && seedKey !== loadedForKey) {
    const t = buildTemplate(template, quote, projectName, projectAddress, contactName);
    // Keep whatever address the user already typed when only the template changes
    setTo(loadedForKey?.startsWith(`${quote.id}:`) && to ? to : defaultTo);
    setSubject(t.subject);
    setBody(t.body);
    setError(null);
    setSent(false);
    setLoadedForKey(seedKey);
  }

  async function send() {
    if (!quote) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/send-sub-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, quoteId: quote.id, to, subject, body }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || "Failed to send");
        return;
      }
      setSent(true);
      onSent(quote.id);
      setTimeout(() => onClose(), 900);
    } catch {
      setError("Failed to send");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={!!quote} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-amber-500" /> Email {quote?.subcontractor_name}
          </DialogTitle>
          <DialogDescription>
            Sends from your Gmail with the company signature.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Template chips */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {(Object.keys(TEMPLATE_LABELS) as TemplateKey[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => onTemplateChange(key)}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  template === key
                    ? "border-amber-500/50 bg-amber-500/15 text-amber-500"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {key === "award" && <Trophy className="mr-1 inline h-3 w-3" />}
                {TEMPLATE_LABELS[key]}
              </button>
            ))}
          </div>

          <div>
            <label className="text-[10px] text-muted-foreground font-medium uppercase">To</label>
            <Input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="sub@company.com"
              className="h-9 text-sm mt-1"
              type="email"
            />
            {!defaultTo && !to && (
              <p className="mt-1 text-[11px] text-amber-500">
                No email on file for this sub — type one in (it&apos;ll still log to the project).
              </p>
            )}
          </div>

          <div>
            <label className="text-[10px] text-muted-foreground font-medium uppercase">Subject</label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} className="h-9 text-sm mt-1" />
          </div>

          <div>
            <label className="text-[10px] text-muted-foreground font-medium uppercase">Message</label>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="text-sm mt-1 min-h-[160px]" />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              className={sent ? "bg-green-600 text-white" : "bg-amber-600 hover:bg-amber-700 text-white"}
              onClick={send}
              disabled={sending || sent || !to.trim()}
            >
              {sending ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : sent ? (
                <Check className="h-4 w-4 mr-1.5" />
              ) : (
                <Mail className="h-4 w-4 mr-1.5" />
              )}
              {sent ? "Sent!" : "Send"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Add trade budget dialog ──────────────────────────────────

function AddTradeBudgetDialog({
  open,
  onOpenChange,
  existingKeys,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingKeys: string[];
  onSave: (tradeKey: string, amount: number) => Promise<string | null>;
}) {
  const [trade, setTrade] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(false);

  if (open && !wasOpen) {
    setWasOpen(true);
    setTrade("");
    setAmount("");
    setError(null);
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  const available = REQUIRED_TRADES.filter((t) => !existingKeys.includes(t.key));

  async function submit() {
    const parsed = parseFloat(amount.replace(/[$,]/g, ""));
    if (!trade) {
      setError("Pick a trade");
      return;
    }
    if (isNaN(parsed) || parsed <= 0) {
      setError("Enter a budget amount");
      return;
    }
    setBusy(true);
    setError(null);
    const err = await onSave(trade, parsed);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add trade budget</DialogTitle>
          <DialogDescription>
            Put a trade on the board with the number you want to hold subs to.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-[10px] text-muted-foreground font-medium uppercase">Trade</label>
            <Select value={trade} onValueChange={setTrade}>
              <SelectTrigger className="h-9 text-sm mt-1 w-full">
                <SelectValue placeholder="Pick trade" />
              </SelectTrigger>
              <SelectContent>
                {(available.length > 0 ? available : REQUIRED_TRADES).map((t) => (
                  <SelectItem key={t.key} value={t.key} className="text-sm">
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground font-medium uppercase">Budget ($)</label>
            <Input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="15,000"
              className="h-9 text-sm mt-1"
            />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button className="bg-amber-600 hover:bg-amber-700 text-white" onClick={submit} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Plus className="h-4 w-4 mr-1.5" />}
              Add
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
