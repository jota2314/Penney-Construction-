"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Inbox,
  Archive,
  Search,
  X,
  Sparkles,
  Briefcase,
  Users,
  HardHat,
  Paperclip,
  Download,
  Loader2,
  RefreshCw,
  CornerDownRight,
  Star,
  CheckCircle2,
  Flame,
  Receipt,
  FileText,
  Image as ImageIcon,
  EyeOff,
  Eye,
  ClipboardList,
} from "lucide-react";
import { reconnectGoogle } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { EmailDetail } from "@/components/command-center/email-detail";
import { DraftsList, type DraftRow } from "@/components/command-center/drafts-list";
import type {
  ProjectRef,
  ExistingConversation,
  MatchedEntityNames,
  StoredEmail,
} from "@/components/command-center/email-detail-types";

// Inbox-only extension: adds `is_dismissed` (used to hide soft-deleted rows)
// plus the cron/push auto-triage outcome to the canonical StoredEmail.
// Shadowing the imported alias is intentional.
type InboxEmail = StoredEmail & {
  is_dismissed: boolean;
  auto_triaged_at?: string | null;
  auto_triage_outcome?: string | null;
};

type Filter = "all" | "hot" | "review" | "quote" | "invoice" | "drawing";

const FILTERS: { key: Filter; label: string; icon: typeof Inbox; activeClass: string }[] = [
  { key: "all", label: "All", icon: Inbox, activeClass: "bg-foreground/10 text-foreground border-foreground/20" },
  { key: "hot", label: "Hot", icon: Flame, activeClass: "bg-red-500/15 text-red-300 border-red-500/40" },
  { key: "review", label: "Review", icon: ClipboardList, activeClass: "bg-orange-500/15 text-orange-300 border-orange-500/40" },
  { key: "quote", label: "Quotes", icon: FileText, activeClass: "bg-amber-500/15 text-amber-300 border-amber-500/40" },
  { key: "invoice", label: "Invoices", icon: Receipt, activeClass: "bg-rose-500/15 text-rose-300 border-rose-500/40" },
  { key: "drawing", label: "Drawings", icon: ImageIcon, activeClass: "bg-cyan-500/15 text-cyan-300 border-cyan-500/40" },
];

// The auto-triage daemon (cron + Gmail push) files high-confidence emails on
// its own. What it COULDN'T file confidently lands here for a human to finish:
//  - "ambiguous": matched a project but the content type wasn't a clear
//    invoice/quote/contract, so it didn't pick a category.
//  - "no_match" WITH an attachment: there's a file worth filing but no project
//    matched. (no_match with no attachment is just unmatched mail, not review.)
function reviewReason(e: InboxEmail): string | null {
  const o = e.auto_triage_outcome;
  if (!o) return null;
  const hasAtt = (e.attachments?.length ?? 0) > 0;
  if (o === "ambiguous") return "Pick category";
  if (o === "no_match" && hasAtt) return "Needs project";
  return null;
}

function isReview(e: InboxEmail): boolean {
  return reviewReason(e) !== null;
}

const CONTENT_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  invoice: { label: "Invoice", color: "bg-rose-500/15 text-rose-300 border-rose-500/30" },
  quote: { label: "Quote", color: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  payment_receipt: { label: "Receipt", color: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  schedule: { label: "Schedule", color: "bg-blue-500/15 text-blue-300 border-blue-500/30" },
  contract: { label: "Contract", color: "bg-violet-500/15 text-violet-300 border-violet-500/30" },
  inquiry: { label: "New Lead", color: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30" },
  update: { label: "Update", color: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30" },
  newsletter: { label: "Newsletter", color: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30" },
  other: { label: "", color: "" },
};

const DRAWING_PATTERN = /drawing|blueprint|elevation|floor[\s_-]?plan|site[\s_-]?plan|architectural|sheet|\bplan\b|\bset\b/i;
const DRAWING_EXT = /\.(pdf|dwg|dxf|tiff?|png|jpe?g)$/i;

function isJunk(e: InboxEmail): boolean {
  return (
    e.urgency === "junk" ||
    e.sender_type === "spam" ||
    e.content_type === "newsletter"
  );
}

function isHot(e: InboxEmail): boolean {
  return e.urgency === "urgent" || e.ai_action_required === true;
}

function hasDrawings(e: InboxEmail): boolean {
  if (!e.attachments?.length) return false;
  return e.attachments.some(
    (a) =>
      DRAWING_PATTERN.test(a.filename || "") &&
      DRAWING_EXT.test(a.filename || "")
  );
}

function matchesFilter(e: InboxEmail, filter: Filter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "hot":
      return isHot(e);
    case "review":
      return isReview(e);
    case "quote":
      return e.content_type === "quote";
    case "invoice":
      return e.content_type === "invoice";
    case "drawing":
      return hasDrawings(e);
  }
}

function avatarColor(seed: string): { bg: string; text: string } {
  const colors = [
    { bg: "bg-amber-500/20", text: "text-amber-300" },
    { bg: "bg-blue-500/20", text: "text-blue-300" },
    { bg: "bg-emerald-500/20", text: "text-emerald-300" },
    { bg: "bg-rose-500/20", text: "text-rose-300" },
    { bg: "bg-violet-500/20", text: "text-violet-300" },
    { bg: "bg-cyan-500/20", text: "text-cyan-300" },
    { bg: "bg-orange-500/20", text: "text-orange-300" },
    { bg: "bg-fuchsia-500/20", text: "text-fuchsia-300" },
  ];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

function initials(name: string, email: string): string {
  const source = name?.trim() || email.split("@")[0];
  const parts = source.replace(/[^a-zA-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface EmailInboxProps {
  initialEmails: InboxEmail[];
  totalCount: number;
  unprocessedCount?: number;
  subEmails?: string[];
  customerEmails?: string[];
  customerNames?: Record<string, string>;
  subNames?: Record<string, string>;
  projectNames?: Record<string, string>;
  projects?: ProjectRef[];
  userName?: string;
  drafts?: DraftRow[];
}

export function EmailInbox({
  initialEmails,
  totalCount,
  customerNames = {},
  subNames = {},
  projectNames = {},
  projects = [],
  userName = "User",
  drafts = [],
}: EmailInboxProps) {
  const router = useRouter();
  const [emails, setEmails] = useState<InboxEmail[]>(initialEmails);
  const [filter, setFilter] = useState<Filter>("all");
  // "drafts" swaps the whole list over to unsent drafts. It is a mode, not a
  // content filter, which is why it sits apart from FILTERS in the bar.
  const [mode, setMode] = useState<"inbox" | "drafts">("inbox");
  const [showJunk, setShowJunk] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [fetchMessage, setFetchMessage] = useState<string | null>(null);

  useEffect(() => {
    setEmails(initialEmails);
  }, [initialEmails]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(min-width: 1024px)").matches) return;

    const returnUrl = encodeURIComponent(
      window.location.pathname + window.location.search,
    );
    for (const email of initialEmails.slice(0, 8)) {
      router.prefetch(
        `/command-center/email/${email.id}?returnUrl=${returnUrl}`,
      );
    }
  }, [initialEmails, router]);

  const visibleEmails = useMemo(() => {
    let list = emails.filter((e) => !e.is_dismissed && !e.is_processed);
    if (!showJunk) list = list.filter((e) => !isJunk(e));
    list = list.filter((e) => matchesFilter(e, filter));
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (e) =>
          e.subject?.toLowerCase().includes(q) ||
          e.from_name?.toLowerCase().includes(q) ||
          e.from_email?.toLowerCase().includes(q) ||
          e.snippet?.toLowerCase().includes(q) ||
          e.ai_summary?.toLowerCase().includes(q)
      );
    }
    return [...list].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  }, [emails, filter, showJunk, search]);

  const activeSelectedId = visibleEmails.some((email) => email.id === selectedId)
    ? selectedId
    : visibleEmails[0]?.id ?? null;

  const filterCounts = useMemo(() => {
    const counts: Record<Filter, number> = { all: 0, hot: 0, review: 0, quote: 0, invoice: 0, drawing: 0 };
    let junkCount = 0;
    for (const e of emails) {
      if (e.is_processed || e.is_dismissed) continue;
      if (isJunk(e)) {
        junkCount++;
        if (!showJunk) continue;
      }
      counts.all++;
      if (isHot(e)) counts.hot++;
      if (isReview(e)) counts.review++;
      if (e.content_type === "quote") counts.quote++;
      if (e.content_type === "invoice") counts.invoice++;
      if (hasDrawings(e)) counts.drawing++;
    }
    return { ...counts, junk: junkCount };
  }, [emails, showJunk]);

  const selected = useMemo(
    () => visibleEmails.find((e) => e.id === activeSelectedId) ?? null,
    [visibleEmails, activeSelectedId]
  );

  // Existing conversation for the selected email — fetched when selection changes
  // so the embedded right-pane chat can pick up where it left off.
  const [existingConversation, setExistingConversation] =
    useState<ExistingConversation | null>(null);
  const [conversationLoading, setConversationLoading] = useState(false);

  useEffect(() => {
    if (!selected) {
      setExistingConversation(null);
      return;
    }
    let cancelled = false;
    setConversationLoading(true);
    setExistingConversation(null);

    (async () => {
      const supabase = createClient();

      // The list payload ships without `body` (it made the page tens of MB).
      // Hydrate it for the preview pane on first selection, then cache it on
      // the row so re-selecting is instant.
      if (selected.body == null) {
        const { data: full } = await supabase
          .from("inbox_emails")
          .select("body, attachments")
          .eq("id", selected.id)
          .maybeSingle();
        if (cancelled) return;
        if (full) {
          setEmails((prev) =>
            prev.map((e) =>
              e.id === selected.id
                ? { ...e, body: full.body ?? "", attachments: full.attachments ?? e.attachments }
                : e
            )
          );
        }
      }

      const { data: conv } = await supabase
        .from("conversations")
        .select("id")
        .eq("inbox_email_id", selected.id)
        .maybeSingle();

      if (cancelled) return;

      if (!conv) {
        setExistingConversation(null);
        setConversationLoading(false);
        return;
      }

      const { data: msgs } = await supabase
        .from("conversation_messages")
        .select("id, role, content, source, metadata")
        .eq("conversation_id", conv.id)
        .order("created_at", { ascending: true });

      if (cancelled) return;
      setExistingConversation({ id: conv.id, messages: msgs ?? [] });
      setConversationLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // Keyed on the id, not the object: the body-hydration setEmails above
    // replaces the row object, and re-running on identity would refetch the
    // conversation for the same email.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSelectedId]);

  // Build matched-entity name chips from the existing inbox lookup maps.
  const matchedNames: MatchedEntityNames = useMemo(() => {
    if (!selected) return { customer: null, sub: null, project: null };
    return {
      customer: selected.matched_customer_id
        ? customerNames[selected.matched_customer_id] ?? null
        : null,
      sub: selected.matched_subcontractor_id
        ? subNames[selected.matched_subcontractor_id] ?? null
        : null,
      project: selected.matched_project_id
        ? projectNames[selected.matched_project_id] ?? null
        : null,
    };
  }, [selected, customerNames, subNames, projectNames]);

  function handleRowClick(email: InboxEmail) {
    if (typeof window !== "undefined") {
      const isDesktop = window.matchMedia("(min-width: 1024px)").matches;
      if (isDesktop) {
        setSelectedId(email.id);
        return;
      }
    }
    const returnUrl = encodeURIComponent(
      window.location.pathname + window.location.search
    );
    router.push(`/command-center/email/${email.id}?returnUrl=${returnUrl}`);
  }

  async function handleFetchMore() {
    setFetching(true);
    setFetchMessage(null);
    setNeedsReconnect(false);
    try {
      const res = await fetch("/api/fetch-and-store-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 20 }),
      });
      const data = await res.json();
      if (data.error) {
        if (data.error.includes("OAuth") || data.error.includes("token")) {
          setNeedsReconnect(true);
          return;
        }
        throw new Error(data.error);
      }
      const syncErrors = Array.isArray(data.errors) ? data.errors : [];
      setFetchMessage(
        syncErrors.length > 0
          ? `${data.message}. ${syncErrors[0]}`
          : data.message
      );
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed";
      if (msg.includes("OAuth") || msg.includes("token")) setNeedsReconnect(true);
      else setFetchMessage(msg);
    } finally {
      setFetching(false);
    }
  }

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden min-h-0">
      {/* ── Top filter bar ── */}
      <div className="border-b bg-background sticky top-0 z-10">
        <div className="flex items-center gap-1 overflow-x-auto px-3 py-2">
          <div className="hidden lg:flex items-center gap-1.5 mr-2 text-xs text-muted-foreground shrink-0">
            <Sparkles className="h-3.5 w-3.5 text-amber-500" />
            <span className="tabular-nums">{totalCount.toLocaleString()}</span>
          </div>

          {mode === "inbox" && FILTERS.map((f) => {
            const active = filter === f.key;
            const count = filterCounts[f.key];
            const Icon = f.icon;
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium shrink-0 transition-all border ${
                  active
                    ? f.activeClass
                    : "bg-muted/40 text-muted-foreground border-transparent hover:bg-muted/70"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {f.label}
                {count > 0 && (
                  <span className="text-[10px] opacity-70 tabular-nums">{count}</span>
                )}
              </button>
            );
          })}

          {mode === "inbox" && (
            <div className="mx-1 h-5 w-px bg-border shrink-0" aria-hidden="true" />
          )}

          <button
            onClick={() => setMode((m) => (m === "drafts" ? "inbox" : "drafts"))}
            aria-pressed={mode === "drafts"}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium shrink-0 transition-all border ${
              mode === "drafts"
                ? "bg-amber-500/15 text-amber-300 border-amber-500/40"
                : "bg-muted/40 text-muted-foreground border-transparent hover:bg-muted/70"
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Drafts
            {drafts.length > 0 && (
              <span className="text-[10px] opacity-70 tabular-nums">{drafts.length}</span>
            )}
          </button>

          {mode === "inbox" && (
          <div className="ml-auto flex items-center gap-1 shrink-0 pl-2">
            <button
              onClick={() => setShowJunk((v) => !v)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium transition-all border ${
                showJunk
                  ? "bg-zinc-500/20 text-zinc-200 border-zinc-500/40"
                  : "bg-muted/40 text-muted-foreground border-transparent hover:bg-muted/70"
              }`}
              title={showJunk ? "Hide junk" : "Show junk"}
            >
              {showJunk ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              <Archive className="h-3.5 w-3.5" />
              {filterCounts.junk > 0 && (
                <span className="text-[10px] opacity-70 tabular-nums">{filterCounts.junk}</span>
              )}
            </button>
            <Button
              onClick={handleFetchMore}
              disabled={fetching}
              variant="default"
              size="sm"
              className="h-8 bg-amber-600 hover:bg-amber-700 text-white"
            >
              {fetching ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <>
                  <Download className="h-3.5 w-3.5 lg:mr-1.5" />
                  <span className="ml-1.5">Fetch</span>
                </>
              )}
            </Button>
          </div>
          )}
        </div>
      </div>

      {mode === "drafts" ? (
        <DraftsList drafts={drafts} />
      ) : (
      <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
      {/* ── List ── */}
      <section className="w-full flex-1 lg:flex-none lg:w-[420px] lg:shrink-0 lg:border-r flex flex-col min-w-0 min-h-0">
        {needsReconnect && (
          <div className="flex items-center gap-2 p-2 bg-amber-500/10 border-b border-amber-500/20">
            <RefreshCw className="h-4 w-4 text-amber-500 shrink-0" />
            <p className="text-xs text-amber-200 flex-1">Google session expired</p>
            <form action={reconnectGoogle}>
              <Button
                type="submit"
                size="sm"
                className="bg-amber-600 hover:bg-amber-700 text-white text-xs h-7"
              >
                Reconnect
              </Button>
            </form>
          </div>
        )}

        <div className="p-3 border-b">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search inbox…"
              className="w-full pl-8 pr-8 h-8 text-sm rounded-md bg-muted/40 border border-border/50 focus:outline-none focus:border-amber-500/50 focus:bg-background"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {fetchMessage && !needsReconnect && (
          <div className="px-3 py-1.5 border-b text-[11px] text-muted-foreground">
            {fetchMessage}
          </div>
        )}

        <div className="flex-1 overflow-y-auto overscroll-contain pb-24 md:pb-0">
          {visibleEmails.length === 0 ? (
            <div className="h-full flex items-center justify-center p-8 text-center">
              <div>
                <div className="h-12 w-12 mx-auto rounded-full bg-emerald-500/10 flex items-center justify-center mb-3">
                  <CheckCircle2 className="h-6 w-6 text-emerald-400" />
                </div>
                <p className="text-sm font-medium">All caught up</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Nothing in {FILTERS.find((f) => f.key === filter)?.label}
                </p>
                <Button
                  onClick={handleFetchMore}
                  disabled={fetching}
                  size="sm"
                  className="mt-4 bg-amber-600 hover:bg-amber-700 text-white"
                >
                  {fetching ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Download className="h-4 w-4 mr-2" />
                  )}
                  Fetch Gmail
                </Button>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-border/40">
              {visibleEmails.map((email) => (
                <EmailListRow
                  key={email.id}
                  email={email}
                  selected={email.id === activeSelectedId}
                  onClick={() => handleRowClick(email)}
                  customerNames={customerNames}
                  subNames={subNames}
                  projectNames={projectNames}
                />
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ── Right: full email + AI chat (desktop only) ── */}
      <section className="hidden lg:flex flex-1 min-w-0 flex-col">
        {selected ? (
          conversationLoading ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <EmailDetail
              key={selected.id}
              email={selected}
              projects={projects}
              userName={userName}
              existingConversation={existingConversation}
              matchedNames={matchedNames}
            />
          )
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <Inbox className="h-12 w-12 mx-auto opacity-20 mb-3" />
              <p className="text-sm">Select an email to preview</p>
            </div>
          </div>
        )}
      </section>
      </div>
      )}
    </div>
  );
}

/* ─── Email list row ─── */

function EmailListRow({
  email,
  selected,
  onClick,
  customerNames,
  subNames,
  projectNames,
}: {
  email: InboxEmail;
  selected: boolean;
  onClick: () => void;
  customerNames: Record<string, string>;
  subNames: Record<string, string>;
  projectNames: Record<string, string>;
}) {
  const senderName =
    email.direction === "outbound"
      ? email.to_name || email.to_email
      : email.from_name || email.from_email;
  const senderEmail =
    email.direction === "outbound" ? email.to_email : email.from_email;
  const av = avatarColor(senderEmail);
  const projectName = email.matched_project_id
    ? projectNames[email.matched_project_id]
    : null;
  const customerName = email.matched_customer_id
    ? customerNames[email.matched_customer_id]
    : null;
  const subName = email.matched_subcontractor_id
    ? subNames[email.matched_subcontractor_id]
    : null;

  const urgencyBg =
    email.urgency === "urgent"
      ? "border-l-red-500"
      : email.urgency === "normal"
      ? "border-l-amber-500"
      : email.urgency === "low"
      ? "border-l-blue-500/50"
      : email.urgency === "junk"
      ? "border-l-zinc-500/30"
      : "border-l-transparent";

  const ctLabel = email.content_type ? CONTENT_TYPE_LABELS[email.content_type] : null;
  const showCt = ctLabel?.label;
  const review = reviewReason(email);

  return (
    <li>
      <button
        onClick={onClick}
        className={`w-full text-left border-l-2 ${urgencyBg} transition-colors ${
          selected ? "bg-amber-500/10" : "bg-background hover:bg-muted/40"
        } ${email.urgency === "junk" ? "opacity-60" : ""}`}
      >
        <div className="px-3 py-3 flex gap-3 min-w-0">
          <div
            className={`h-9 w-9 shrink-0 rounded-full flex items-center justify-center text-[11px] font-semibold ${av.bg} ${av.text}`}
          >
            {initials(senderName, senderEmail)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <p className="text-sm font-medium truncate">
                {email.direction === "outbound" && (
                  <CornerDownRight className="h-3 w-3 inline mr-1 text-emerald-400/60" />
                )}
                {senderName}
              </p>
              <span className="text-[10px] text-muted-foreground tabular-nums shrink-0 ml-auto">
                {formatDate(email.date)}
              </span>
            </div>

            <div className="flex items-center gap-1.5 mt-0.5">
              {email.urgency === "urgent" && (
                <span className="inline-flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded bg-red-500/20 text-red-400 font-semibold">
                  <AlertCircle className="h-2.5 w-2.5" />
                  URGENT
                </span>
              )}
              {email.ai_action_required && email.urgency !== "urgent" && (
                <Star className="h-3 w-3 text-amber-400 shrink-0" />
              )}
              <p className="text-[13px] truncate text-foreground/90">
                {email.subject || "(no subject)"}
              </p>
            </div>

            {email.ai_summary ? (
              <p className="text-xs text-muted-foreground truncate mt-0.5 flex items-center gap-1">
                <Sparkles className="h-2.5 w-2.5 text-amber-500/60 shrink-0" />
                {email.ai_summary}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground/70 truncate mt-0.5">
                {email.snippet}
              </p>
            )}

            {(review ||
              showCt ||
              projectName ||
              customerName ||
              subName ||
              (email.attachments?.length ?? 0) > 0) && (
              <div className="flex gap-1 mt-1.5 flex-wrap">
                {review && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border bg-orange-500/15 text-orange-300 border-orange-500/40 font-medium">
                    <ClipboardList className="h-2.5 w-2.5" />
                    {review}
                  </span>
                )}
                {showCt && (
                  <span
                    className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border ${ctLabel.color}`}
                  >
                    {ctLabel.label}
                  </span>
                )}
                {projectName && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
                    <Briefcase className="h-2.5 w-2.5" />
                    {projectName}
                  </span>
                )}
                {customerName && !projectName && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20">
                    <Users className="h-2.5 w-2.5" />
                    {customerName}
                  </span>
                )}
                {subName && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-zinc-500/10 text-zinc-300 border border-zinc-500/20">
                    <HardHat className="h-2.5 w-2.5" />
                    {subName}
                  </span>
                )}
                {(email.attachments?.length ?? 0) > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                    <Paperclip className="h-2.5 w-2.5" />
                    {email.attachments.length}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}

