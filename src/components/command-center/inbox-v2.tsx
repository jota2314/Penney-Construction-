"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Inbox,
  AlertCircle,
  Clock,
  Sparkles,
  Trash2,
  Reply,
  Check,
  Briefcase,
  Users,
  HardHat,
  Archive,
  Zap,
  Coffee,
  ArrowRight,
  Search,
  Paperclip,
  X,
  CornerDownRight,
  CheckCircle2,
  Star,
  Send,
  ArrowLeft,
  Filter,
  Menu,
  Wand2,
  Undo2,
  Eraser,
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import { formatEmailBody } from "@/lib/email/format-email-body";

interface Email {
  id: string;
  gmail_message_id: string;
  thread_id: string | null;
  subject: string;
  from_name: string;
  from_email: string;
  to_name: string;
  to_email: string;
  date: string;
  direction: string;
  snippet: string;
  body: string | null;
  is_processed: boolean;
  is_dismissed: boolean;
  project_id: string | null;
  attachments: { filename: string; mimeType: string; storage_path: string | null }[];
  sender_type: string | null;
  urgency: string | null;
  ai_summary: string | null;
  ai_action_required: boolean | null;
  content_type: string | null;
  matched_customer_id: string | null;
  matched_subcontractor_id: string | null;
  matched_project_id: string | null;
  ai_classified_at: string | null;
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

interface Props {
  initialEmails: Email[];
  totalCount: number;
  customerNames: Record<string, string>;
  subNames: Record<string, string>;
  projectNames: Record<string, string>;
}

type SmartFolder = "needs-reply" | "today" | "waiting" | "fyi" | "all" | "junk";

const FOLDERS: { key: SmartFolder; label: string; short: string; icon: typeof Inbox; color: string }[] = [
  { key: "needs-reply", label: "Needs Reply", short: "Reply", icon: AlertCircle, color: "text-red-400" },
  { key: "today", label: "Today", short: "Today", icon: Zap, color: "text-amber-400" },
  { key: "waiting", label: "Waiting On", short: "Waiting", icon: Clock, color: "text-blue-400" },
  { key: "fyi", label: "FYI", short: "FYI", icon: Coffee, color: "text-zinc-400" },
  { key: "all", label: "All", short: "All", icon: Inbox, color: "text-foreground" },
  { key: "junk", label: "Junk", short: "Junk", icon: Archive, color: "text-zinc-500" },
];

const QUICK_REPLIES = [
  "Got it, thanks!",
  "Looks good — proceeding.",
  "Let me check and get back to you.",
  "Can we schedule a call?",
  "Please send updated pricing.",
];

const SWIPE_THRESHOLD = 70;

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

function classifyToFolder(e: Email): SmartFolder {
  if (e.urgency === "junk" || e.sender_type === "spam") return "junk";
  if (e.urgency === "urgent" || e.ai_action_required) return "needs-reply";
  if (e.urgency === "normal") return "today";
  if (e.direction === "outbound") return "waiting";
  return "fyi";
}

export function InboxV2({
  initialEmails,
  totalCount,
  customerNames,
  subNames,
  projectNames,
}: Props) {
  const router = useRouter();
  const [emails, setEmails] = useState<Email[]>(initialEmails);
  const [folder, setFolder] = useState<SmartFolder>("needs-reply");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showJunk, setShowJunk] = useState(false);
  const [folderSheetOpen, setFolderSheetOpen] = useState(false);
  const [mobileView, setMobileView] = useState<"list" | "preview">("list");
  // Auto-clear: when ON, opening a non-actionable email auto-marks it processed after 1.5s.
  const [autoClear, setAutoClear] = useState(true);
  // Last cleared id(s) for undo (5 sec window).
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const undoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const visibleEmails = useMemo(() => {
    let list = emails.filter((e) => !e.is_dismissed && !e.is_processed);
    if (folder === "junk") {
      list = emails.filter((e) => classifyToFolder(e) === "junk" && !e.is_processed);
    } else if (folder !== "all") {
      list = list.filter((e) => classifyToFolder(e) === folder);
    } else {
      if (!showJunk) list = list.filter((e) => classifyToFolder(e) !== "junk");
    }
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
    return list;
  }, [emails, folder, search, showJunk]);

  const activeSelectedId = visibleEmails.some((email) => email.id === selectedId)
    ? selectedId
    : visibleEmails[0]?.id ?? null;

  const folderCounts = useMemo(() => {
    const counts: Record<SmartFolder, number> = {
      "needs-reply": 0, today: 0, waiting: 0, fyi: 0, all: 0, junk: 0,
    };
    for (const e of emails) {
      if (e.is_processed || e.is_dismissed) continue;
      counts.all++;
      const f = classifyToFolder(e);
      counts[f]++;
    }
    return counts;
  }, [emails]);

  const selected = useMemo(
    () => visibleEmails.find((e) => e.id === activeSelectedId) ?? null,
    [visibleEmails, activeSelectedId]
  );

  function pushUndo(ids: string[]) {
    setUndoStack(ids);
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    undoTimeoutRef.current = setTimeout(() => setUndoStack([]), 5000);
  }

  function dismissUndo() {
    setUndoStack([]);
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
  }

  async function markDone(id: string, opts?: { silent?: boolean }) {
    setEmails((prev) =>
      prev.map((e) => (e.id === id ? { ...e, is_processed: true } : e))
    );
    if (!opts?.silent) pushUndo([id]);
    await fetch("/api/inbox-bulk-action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [id], action: "done" }),
    });
  }

  async function undoLast() {
    if (undoStack.length === 0) return;
    const ids = undoStack;
    setEmails((prev) =>
      prev.map((e) => (ids.includes(e.id) ? { ...e, is_processed: false, is_dismissed: false } : e))
    );
    setUndoStack([]);
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    await fetch("/api/inbox-bulk-action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, action: "undo" }),
    });
  }

  async function clearVisible() {
    const ids = visibleEmails.map((e) => e.id);
    if (ids.length === 0) return;
    setEmails((prev) =>
      prev.map((e) => (ids.includes(e.id) ? { ...e, is_processed: true } : e))
    );
    pushUndo(ids);
    await fetch("/api/inbox-bulk-action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, action: "done" }),
    });
  }

  async function dismiss(id: string) {
    setEmails((prev) =>
      prev.map((e) => (e.id === id ? { ...e, is_dismissed: true } : e))
    );
    pushUndo([id]);
    await fetch("/api/inbox-bulk-action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [id], action: "dismiss" }),
    });
  }

  function openInChat(email: Email) {
    const returnUrl = encodeURIComponent("/command-center/inbox-v2");
    router.push(`/command-center/email/${email.id}?returnUrl=${returnUrl}`);
  }

  function handleSelect(id: string) {
    setSelectedId(id);
    setMobileView("preview");
  }

  const isInboxZero = visibleEmails.length === 0;
  const activeFolder = FOLDERS.find((f) => f.key === folder)!;

  return (
    <div className="h-full flex flex-col lg:flex-row bg-background overflow-hidden">
      {/* ── Folder sheet (mobile) ── */}
      {folderSheetOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
          onClick={() => setFolderSheetOpen(false)}
        >
          <div
            className="absolute bottom-0 left-0 right-0 bg-background rounded-t-2xl border-t pb-[env(safe-area-inset-bottom)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center pt-2 pb-1">
              <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
            </div>
            <div className="px-4 pt-2 pb-4">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-amber-500" />
                Smart folders
              </h3>

              {/* Auto-clear toggle */}
              <button
                onClick={() => setAutoClear(!autoClear)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl mb-2 text-sm bg-muted/40 border border-border/50"
              >
                <Wand2 className={`h-4 w-4 ${autoClear ? "text-amber-400" : "text-muted-foreground"}`} />
                <div className="flex-1 text-left">
                  <p className={autoClear ? "text-foreground" : "text-muted-foreground"}>Auto-clear on read</p>
                  <p className="text-[10px] text-muted-foreground">Non-actionable emails clear themselves after you read them</p>
                </div>
                <div className={`h-5 w-9 rounded-full p-0.5 transition-colors ${autoClear ? "bg-amber-500" : "bg-muted-foreground/30"}`}>
                  <div className={`h-4 w-4 rounded-full bg-background transition-transform ${autoClear ? "translate-x-4" : ""}`} />
                </div>
              </button>

              <div className="space-y-1">
                {FOLDERS.map((f) => {
                  const Icon = f.icon;
                  const count = folderCounts[f.key];
                  const active = folder === f.key;
                  return (
                    <button
                      key={f.key}
                      onClick={() => {
                        setFolder(f.key);
                        setFolderSheetOpen(false);
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-base ${
                        active
                          ? "bg-amber-500/15 text-foreground"
                          : "hover:bg-muted/60 text-muted-foreground"
                      }`}
                    >
                      <Icon className={`h-5 w-5 ${active ? f.color : ""}`} />
                      <span className="flex-1 text-left">{f.label}</span>
                      {count > 0 && (
                        <span
                          className={`text-xs tabular-nums px-2 py-0.5 rounded-full ${
                            f.key === "needs-reply"
                              ? "bg-red-500/20 text-red-400"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Left rail (desktop only) ── */}
      <aside className="hidden lg:flex w-56 shrink-0 border-r flex-col bg-muted/20">
        <div className="p-3 border-b">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-amber-500" />
            Smart Inbox
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {totalCount.toLocaleString()} emails total
          </p>
        </div>
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {FOLDERS.map((f) => {
            const active = folder === f.key;
            const count = folderCounts[f.key];
            const Icon = f.icon;
            return (
              <button
                key={f.key}
                onClick={() => setFolder(f.key)}
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-sm transition-all ${
                  active
                    ? "bg-amber-500/15 text-foreground border border-amber-500/30"
                    : "hover:bg-muted/60 border border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className={`h-4 w-4 ${active ? f.color : ""}`} />
                <span className="flex-1 text-left">{f.label}</span>
                {count > 0 && (
                  <span
                    className={`text-[10px] tabular-nums px-1.5 py-0.5 rounded ${
                      f.key === "needs-reply"
                        ? "bg-red-500/20 text-red-400"
                        : active
                        ? "bg-amber-500/20 text-amber-400"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="p-3 border-t text-[10px] text-muted-foreground">
          <div className="flex justify-between">
            <span>Classified</span>
            <span className="tabular-nums text-foreground">
              {emails.filter((e) => e.ai_classified_at).length}/{emails.length}
            </span>
          </div>
        </div>
      </aside>

      {/* ── Middle: list ── */}
      <section
        className={`w-full lg:w-[420px] shrink-0 lg:border-r flex-col min-w-0 ${
          mobileView === "list" ? "flex" : "hidden lg:flex"
        }`}
      >
        {/* Mobile-only: folder bar + search */}
        <div className="lg:hidden border-b bg-background sticky top-0 z-10">
          <div className="flex items-center gap-2 px-3 py-2.5">
            <button
              onClick={() => setFolderSheetOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted active:bg-muted/70"
            >
              <activeFolder.icon className={`h-4 w-4 ${activeFolder.color}`} />
              <span className="text-sm font-medium">{activeFolder.label}</span>
              {folderCounts[folder] > 0 && (
                <span
                  className={`text-[10px] tabular-nums px-1.5 py-0.5 rounded-full ml-1 ${
                    folder === "needs-reply"
                      ? "bg-red-500/20 text-red-400"
                      : "bg-background text-muted-foreground"
                  }`}
                >
                  {folderCounts[folder]}
                </span>
              )}
              <Menu className="h-3.5 w-3.5 text-muted-foreground ml-1" />
            </button>
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => setShowJunk(!showJunk)}
                className={`p-2 rounded-full ${
                  showJunk ? "bg-amber-500/20 text-amber-400" : "text-muted-foreground"
                }`}
                title="Show junk in All"
              >
                <Filter className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="px-3 pb-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search inbox…"
                className="w-full pl-9 pr-9 h-10 text-base rounded-full bg-muted/40 border border-border/50 focus:outline-none focus:border-amber-500/50"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Desktop search */}
        <div className="hidden lg:block p-3 border-b">
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

        {/* Bulk clear bar (FYI / junk only) */}
        {(folder === "fyi" || folder === "junk") && visibleEmails.length > 0 && (
          <div className="px-3 py-2 border-b bg-muted/20 flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">
              {visibleEmails.length} {folder === "junk" ? "junk" : "FYI"} email{visibleEmails.length === 1 ? "" : "s"}
            </span>
            <button
              onClick={clearVisible}
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/30 active:scale-95 transition-all"
            >
              <Eraser className="h-3 w-3" />
              Clear all
            </button>
          </div>
        )}

        {/* List */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {isInboxZero ? (
            <InboxZero folder={folder} />
          ) : (
            <ul className="divide-y divide-border/40">
              {visibleEmails.map((email) => (
                <SwipeableEmailRow
                  key={email.id}
                  email={email}
                  selected={email.id === activeSelectedId}
                  onSelect={() => handleSelect(email.id)}
                  onMarkDone={() => markDone(email.id)}
                  onDismiss={() => dismiss(email.id)}
                  customerNames={customerNames}
                  subNames={subNames}
                  projectNames={projectNames}
                />
              ))}
            </ul>
          )}
          {folder === "all" && !showJunk && folderCounts.junk > 0 && (
            <button
              onClick={() => setShowJunk(true)}
              className="w-full p-3 text-xs text-muted-foreground hover:bg-muted/40 border-t flex items-center justify-center gap-1.5"
            >
              <Archive className="h-3 w-3" />
              Show {folderCounts.junk} junk emails
            </button>
          )}
        </div>
      </section>

      {/* ── Right: preview ── */}
      <section
        className={`flex-1 min-w-0 flex-col ${
          mobileView === "preview" ? "flex" : "hidden lg:flex"
        }`}
      >
        {selected ? (
          <EmailPreview
            email={selected}
            customerNames={customerNames}
            subNames={subNames}
            projectNames={projectNames}
            autoClear={autoClear}
            onMarkDone={(silent) => markDone(selected.id, { silent })}
            onDismiss={() => dismiss(selected.id)}
            onOpenInChat={() => openInChat(selected)}
            onBack={() => setMobileView("list")}
          />
        ) : (
          <div className="hidden lg:flex flex-1 items-center justify-center text-muted-foreground">
            <div className="text-center">
              <Inbox className="h-12 w-12 mx-auto opacity-20 mb-3" />
              <p className="text-sm">Select an email to preview</p>
            </div>
          </div>
        )}
      </section>

      {/* ── Undo toast (fixed bottom-center) ── */}
      {undoStack.length > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="flex items-center gap-2 bg-foreground text-background px-3 py-2 rounded-full shadow-lg border border-border/30">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            <span className="text-xs font-medium">
              {undoStack.length === 1 ? "Cleared" : `Cleared ${undoStack.length}`}
            </span>
            <button
              onClick={undoLast}
              className="ml-1 flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-background text-foreground hover:bg-amber-500/15 hover:text-amber-500 transition-colors"
            >
              <Undo2 className="h-3 w-3" />
              Undo
            </button>
            <button
              onClick={dismissUndo}
              className="text-background/60 hover:text-background"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Swipeable email row (mobile-friendly + desktop hover actions) ─── */

function SwipeableEmailRow({
  email,
  selected,
  onSelect,
  onMarkDone,
  onDismiss,
  customerNames,
  subNames,
  projectNames,
}: {
  email: Email;
  selected: boolean;
  onSelect: () => void;
  onMarkDone: () => void;
  onDismiss: () => void;
  customerNames: Record<string, string>;
  subNames: Record<string, string>;
  projectNames: Record<string, string>;
}) {
  const startX = useRef(0);
  const startY = useRef(0);
  const swiping = useRef(false);
  const locked = useRef(false);
  const isHorizontal = useRef(false);
  const currentX = useRef(0);
  const [offset, setOffset] = useState(0);
  const [released, setReleased] = useState(false);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    currentX.current = 0;
    swiping.current = true;
    locked.current = false;
    isHorizontal.current = false;
    setReleased(false);
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!swiping.current) return;
    const dx = e.touches[0].clientX - startX.current;
    const dy = e.touches[0].clientY - startY.current;
    if (!locked.current && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      locked.current = true;
      isHorizontal.current = Math.abs(dx) > Math.abs(dy);
    }
    if (!locked.current || !isHorizontal.current) return;
    const dampened = dx > 0 ? Math.min(dx * 0.7, 130) : Math.max(dx * 0.7, -130);
    currentX.current = dampened;
    setOffset(dampened);
  }, []);

  const onTouchEnd = useCallback(() => {
    if (!swiping.current) return;
    swiping.current = false;
    const dx = currentX.current;
    if (dx > SWIPE_THRESHOLD) {
      // right swipe → mark done
      setReleased(true);
      setOffset(300);
      setTimeout(() => {
        onMarkDone();
        setOffset(0);
        setReleased(false);
      }, 180);
    } else if (dx < -SWIPE_THRESHOLD) {
      // left swipe → dismiss
      setReleased(true);
      setOffset(-300);
      setTimeout(() => {
        onDismiss();
        setOffset(0);
        setReleased(false);
      }, 180);
    } else {
      setReleased(true);
      setOffset(0);
    }
  }, [onMarkDone, onDismiss]);

  const senderName = email.direction === "outbound"
    ? email.to_name || email.to_email
    : email.from_name || email.from_email;
  const senderEmail = email.direction === "outbound" ? email.to_email : email.from_email;
  const av = avatarColor(senderEmail);
  const projectName = email.matched_project_id ? projectNames[email.matched_project_id] : null;
  const customerName = email.matched_customer_id ? customerNames[email.matched_customer_id] : null;
  const subName = email.matched_subcontractor_id ? subNames[email.matched_subcontractor_id] : null;

  const urgencyBg =
    email.urgency === "urgent" ? "border-l-red-500" :
    email.urgency === "normal" ? "border-l-amber-500" :
    email.urgency === "low" ? "border-l-blue-500/50" :
    email.urgency === "junk" ? "border-l-zinc-500/30" :
    "border-l-transparent";

  return (
    <li className="relative overflow-hidden bg-background">
      {/* Behind: dismiss (right side, revealed on left swipe) */}
      <div className="absolute inset-0 flex items-center justify-end px-6 bg-red-500/90">
        <div className="flex items-center gap-2 text-white font-medium text-sm">
          <Trash2 className="h-5 w-5" />
          Dismiss
        </div>
      </div>
      {/* Behind: done (left side, revealed on right swipe) */}
      <div className="absolute inset-0 flex items-center justify-start px-6 bg-emerald-500/90">
        <div className="flex items-center gap-2 text-white font-medium text-sm">
          <Check className="h-5 w-5" />
          Done
        </div>
      </div>

      <div
        onClick={onSelect}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        className={`group relative cursor-pointer border-l-2 ${urgencyBg} transition-colors ${
          selected ? "bg-amber-500/10" : "bg-background hover:bg-muted/40"
        } ${email.urgency === "junk" ? "opacity-60" : ""}`}
        style={{
          transform: `translateX(${offset}px)`,
          transition: released ? "transform 0.18s ease-out" : "none",
        }}
      >
        <div className="px-3 py-3 flex gap-3 min-w-0">
          {/* Avatar */}
          <div
            className={`h-10 w-10 lg:h-9 lg:w-9 shrink-0 rounded-full flex items-center justify-center text-xs lg:text-[11px] font-semibold ${av.bg} ${av.text}`}
          >
            {initials(senderName, senderEmail)}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <p className="text-[14px] lg:text-sm font-medium truncate">
                {email.direction === "outbound" && (
                  <CornerDownRight className="h-3 w-3 inline mr-1 text-emerald-400/60" />
                )}
                {senderName}
              </p>
              <span className="text-[11px] lg:text-[10px] text-muted-foreground tabular-nums shrink-0 ml-auto">
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
              <p className="text-[13px] truncate text-foreground/90">{email.subject || "(no subject)"}</p>
            </div>

            {email.ai_summary ? (
              <p className="text-xs text-muted-foreground truncate mt-0.5 flex items-center gap-1">
                <Sparkles className="h-2.5 w-2.5 text-amber-500/60 shrink-0" />
                {email.ai_summary}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground/70 truncate mt-0.5">{email.snippet}</p>
            )}

            {(() => {
              const ctLabel = email.content_type ? CONTENT_TYPE_LABELS[email.content_type] : null;
              const showCt = ctLabel?.label;
              const hasAnyChip = projectName || customerName || subName || (email.attachments?.length ?? 0) > 0 || showCt;
              if (!hasAnyChip) return null;
              return (
                <div className="flex gap-1 mt-1.5 flex-wrap">
                  {showCt && (
                    <span className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border ${ctLabel.color}`}>
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
              );
            })()}
          </div>
        </div>

        {/* Desktop hover actions */}
        <div className="absolute right-2 top-1/2 -translate-y-1/2 hidden lg:group-hover:flex items-center gap-1 bg-background border rounded-md shadow-sm">
          <button
            onClick={(e) => { e.stopPropagation(); onMarkDone(); }}
            className="p-1.5 hover:bg-emerald-500/15 hover:text-emerald-400 rounded text-muted-foreground"
            title="Mark done"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDismiss(); }}
            className="p-1.5 hover:bg-red-500/15 hover:text-red-400 rounded text-muted-foreground"
            title="Dismiss"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </li>
  );
}

/* ─── Email preview pane ─── */

function EmailPreview({
  email,
  customerNames,
  subNames,
  projectNames,
  autoClear,
  onMarkDone,
  onDismiss,
  onOpenInChat,
  onBack,
}: {
  email: Email;
  customerNames: Record<string, string>;
  subNames: Record<string, string>;
  projectNames: Record<string, string>;
  autoClear: boolean;
  onMarkDone: (silent?: boolean) => void;
  onDismiss: () => void;
  onOpenInChat: () => void;
  onBack: () => void;
}) {
  const [reply, setReply] = useState("");

  // Auto-clear-on-read: if enabled and email is non-actionable, schedule
  // markDone after 1.5s so it disappears once the user has had time to scan it.
  useEffect(() => {
    if (!autoClear) return;
    if (email.is_processed) return;
    const isNonActionable =
      email.ai_action_required === false &&
      email.urgency !== "urgent" &&
      email.urgency !== "normal" &&
      email.direction === "inbound";
    if (!isNonActionable) return;

    const timer = setTimeout(() => onMarkDone(false), 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email.id, autoClear]);
  const senderName = email.from_name || email.from_email;
  const senderEmail = email.from_email;
  const av = avatarColor(senderEmail);
  const projectName = email.matched_project_id ? projectNames[email.matched_project_id] : null;
  const customerName = email.matched_customer_id ? customerNames[email.matched_customer_id] : null;
  const subName = email.matched_subcontractor_id ? subNames[email.matched_subcontractor_id] : null;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Mobile back bar */}
      <div className="lg:hidden flex items-center gap-2 px-2 py-2 border-b sticky top-0 bg-background z-10">
        <button
          onClick={onBack}
          className="p-2 rounded-full active:bg-muted"
          aria-label="Back to inbox"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <span className="text-sm font-medium truncate flex-1">Inbox</span>
        <button
          onClick={() => onMarkDone()}
          className="p-2 rounded-full text-emerald-400 active:bg-emerald-500/10"
          aria-label="Mark done"
        >
          <Check className="h-5 w-5" />
        </button>
        <button
          onClick={onDismiss}
          className="p-2 rounded-full text-red-400 active:bg-red-500/10"
          aria-label="Dismiss"
        >
          <Trash2 className="h-5 w-5" />
        </button>
      </div>

      {/* Header */}
      <div className="px-4 lg:px-5 py-4 border-b flex items-start gap-3">
        <div className={`h-10 w-10 shrink-0 rounded-full flex items-center justify-center text-sm font-semibold ${av.bg} ${av.text}`}>
          {initials(senderName, senderEmail)}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold flex items-center gap-2 flex-wrap">
            <span className="break-words">{email.subject || "(no subject)"}</span>
            {email.urgency === "urgent" && (
              <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 font-bold">
                <AlertCircle className="h-3 w-3" />
                URGENT
              </span>
            )}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            <span className="text-foreground/80">{senderName}</span>
            <span className="mx-1.5 opacity-40">·</span>
            {formatDate(email.date)}
          </p>
          <p className="text-[10px] text-muted-foreground/60 truncate">{senderEmail}</p>
          {(projectName || customerName || subName) && (
            <div className="flex gap-1.5 mt-2 flex-wrap">
              {projectName && (
                <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  <Briefcase className="h-3 w-3" />
                  {projectName}
                </span>
              )}
              {customerName && (
                <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/30">
                  <Users className="h-3 w-3" />
                  {customerName}
                </span>
              )}
              {subName && (
                <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-zinc-500/15 text-zinc-300 border border-zinc-500/30">
                  <HardHat className="h-3 w-3" />
                  {subName}
                </span>
              )}
            </div>
          )}
        </div>
        {/* Desktop action buttons */}
        <div className="hidden lg:flex gap-1 shrink-0">
          <button
            onClick={() => onMarkDone()}
            className="px-2 py-1.5 text-xs rounded-md bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/30 flex items-center gap-1"
          >
            <Check className="h-3 w-3" />
            Done
          </button>
          <button
            onClick={onDismiss}
            className="p-1.5 rounded-md text-muted-foreground hover:bg-red-500/10 hover:text-red-400 border border-transparent hover:border-red-500/30"
            title="Dismiss"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* AI summary banner */}
      {email.ai_summary && (
        <div className="px-4 lg:px-5 py-2.5 bg-amber-500/5 border-b border-amber-500/20 flex items-start gap-2">
          <Sparkles className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-amber-200/90">{email.ai_summary}</p>
            {email.ai_action_required && (
              <p className="text-[10px] text-amber-400/80 mt-0.5 flex items-center gap-1">
                <AlertCircle className="h-2.5 w-2.5" />
                Action required
              </p>
            )}
          </div>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 lg:px-5 py-4">
        <div
          className="prose prose-sm prose-invert max-w-none text-sm text-foreground/80 whitespace-pre-wrap break-words"
          dangerouslySetInnerHTML={{
            __html: formatEmailBody(
              (email.body || email.snippet || "").substring(0, 50000)
            ),
          }}
        />
        {email.attachments?.length > 0 && (
          <div className="mt-6 border-t pt-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
              Attachments ({email.attachments.length})
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {email.attachments.map((a, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 p-2 rounded-md border bg-muted/30"
                >
                  <Paperclip className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs truncate flex-1">{a.filename}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Quick reply chips (horizontal scroll on mobile) */}
      <div className="border-t bg-muted/20 pb-[env(safe-area-inset-bottom)]">
        <div className="px-4 lg:px-5 py-2.5 border-b border-border/50">
          <div className="flex gap-1.5 items-center">
            <Sparkles className="h-3 w-3 text-amber-500/60 shrink-0" />
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0 mr-1">
              Quick reply
            </span>
          </div>
          <div className="flex gap-1.5 mt-1.5 overflow-x-auto pb-1 -mx-1 px-1 snap-x">
            {QUICK_REPLIES.map((r) => (
              <button
                key={r}
                onClick={() => setReply(r)}
                className="shrink-0 snap-start text-[12px] px-3 py-1.5 rounded-full bg-background border border-border/60 text-foreground/80 hover:border-amber-500/40 hover:bg-amber-500/5 active:scale-95 transition-all"
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {/* Composer */}
        <div className="px-3 lg:px-5 py-2.5 flex gap-2 items-end">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Write a reply…"
            rows={1}
            className="flex-1 px-3 py-2.5 text-base lg:text-sm rounded-2xl bg-background border border-border resize-none focus:outline-none focus:border-amber-500/50 max-h-32"
            style={{ minHeight: "44px" }}
          />
          <div className="flex gap-1.5 shrink-0">
            <button
              onClick={onOpenInChat}
              className="h-11 w-11 lg:h-9 lg:w-auto lg:px-3 rounded-full lg:rounded-md border text-muted-foreground active:bg-muted lg:hover:bg-muted flex items-center justify-center gap-1"
              title="Full triage chat"
            >
              <Reply className="h-5 w-5 lg:h-3.5 lg:w-3.5" />
              <span className="hidden lg:inline text-xs">Chat</span>
            </button>
            <button
              disabled={!reply.trim()}
              onClick={onOpenInChat}
              className="h-11 w-11 lg:h-9 lg:w-auto lg:px-3 rounded-full lg:rounded-md bg-amber-500 text-black font-medium hover:bg-amber-600 disabled:opacity-40 flex items-center justify-center gap-1"
            >
              <Send className="h-5 w-5 lg:h-3.5 lg:w-3.5" />
              <span className="hidden lg:inline text-xs">Send</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Inbox Zero ─── */

function InboxZero({ folder }: { folder: SmartFolder }) {
  const messages: Record<SmartFolder, { title: string; sub: string }> = {
    "needs-reply": { title: "Nothing urgent.", sub: "All caught up — go build something." },
    today: { title: "Inbox zero.", sub: "Nothing else needs you today." },
    waiting: { title: "All clear.", sub: "Nothing waiting on a reply." },
    fyi: { title: "No FYI emails.", sub: "Quiet news cycle." },
    all: { title: "Inbox zero! 🎉", sub: "Everything is processed." },
    junk: { title: "No junk.", sub: "Clean inbox." },
  };
  const m = messages[folder];
  return (
    <div className="h-full flex items-center justify-center p-8 text-center">
      <div>
        <div className="h-16 w-16 mx-auto rounded-full bg-emerald-500/10 flex items-center justify-center mb-4">
          <CheckCircle2 className="h-8 w-8 text-emerald-400" />
        </div>
        <h3 className="text-lg font-semibold mb-1">{m.title}</h3>
        <p className="text-sm text-muted-foreground">{m.sub}</p>
        <button className="mt-4 text-xs text-amber-400 hover:underline flex items-center gap-1 mx-auto">
          Take a break
          <ArrowRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
