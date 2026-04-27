"use client";

import { useState, useMemo, useEffect } from "react";
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
  ChevronRight,
  CheckCircle2,
  Star,
  Send,
} from "lucide-react";
import { formatDate } from "@/lib/utils";

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
  matched_customer_id: string | null;
  matched_subcontractor_id: string | null;
  matched_project_id: string | null;
  ai_classified_at: string | null;
}

interface Props {
  initialEmails: Email[];
  totalCount: number;
  customerNames: Record<string, string>;
  subNames: Record<string, string>;
  projectNames: Record<string, string>;
}

type SmartFolder = "needs-reply" | "today" | "waiting" | "fyi" | "all" | "junk";

const FOLDERS: { key: SmartFolder; label: string; icon: typeof Inbox; color: string }[] = [
  { key: "needs-reply", label: "Needs Reply", icon: AlertCircle, color: "text-red-400" },
  { key: "today", label: "Today", icon: Zap, color: "text-amber-400" },
  { key: "waiting", label: "Waiting On", icon: Clock, color: "text-blue-400" },
  { key: "fyi", label: "FYI", icon: Coffee, color: "text-zinc-400" },
  { key: "all", label: "All", icon: Inbox, color: "text-foreground" },
  { key: "junk", label: "Junk", icon: Archive, color: "text-zinc-500" },
];

const QUICK_REPLIES = [
  "Got it, thanks!",
  "Looks good — proceeding.",
  "Let me check and get back to you.",
  "Can we schedule a call?",
  "Please send updated pricing.",
];

// Deterministic colored avatar from a string
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

  // Auto-select first email when folder changes
  const visibleEmails = useMemo(() => {
    let list = emails.filter((e) => !e.is_dismissed && !e.is_processed);
    if (folder === "junk") {
      list = emails.filter((e) => classifyToFolder(e) === "junk" && !e.is_processed);
    } else if (folder !== "all") {
      list = list.filter((e) => classifyToFolder(e) === folder);
    } else {
      // "all" hides junk by default unless toggled
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

  useEffect(() => {
    if (!selectedId && visibleEmails.length > 0) {
      setSelectedId(visibleEmails[0].id);
    } else if (selectedId && !visibleEmails.find((e) => e.id === selectedId)) {
      setSelectedId(visibleEmails[0]?.id ?? null);
    }
  }, [visibleEmails, selectedId]);

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
    () => visibleEmails.find((e) => e.id === selectedId) ?? null,
    [visibleEmails, selectedId]
  );

  async function markDone(id: string) {
    setEmails((prev) =>
      prev.map((e) => (e.id === id ? { ...e, is_processed: true } : e))
    );
    await fetch("/api/fetch-and-store-emails", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emailId: id, is_dismissed: false }),
    });
  }

  async function dismiss(id: string) {
    setEmails((prev) =>
      prev.map((e) => (e.id === id ? { ...e, is_dismissed: true } : e))
    );
    await fetch("/api/fetch-and-store-emails", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emailId: id, is_dismissed: true }),
    });
  }

  function openInChat(email: Email) {
    const returnUrl = encodeURIComponent("/command-center/inbox-v2");
    router.push(`/command-center/email/${email.id}?returnUrl=${returnUrl}`);
  }

  const isInboxZero = visibleEmails.length === 0;

  return (
    <div className="h-full flex bg-background overflow-hidden">
      {/* ── Left rail: smart folders ── */}
      <aside className="w-56 shrink-0 border-r flex flex-col bg-muted/20">
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
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-sm transition-all group ${
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
                      f.key === "needs-reply" && count > 0
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

        {/* Stats footer */}
        <div className="p-3 border-t text-[10px] text-muted-foreground space-y-1">
          <div className="flex justify-between">
            <span>Classified</span>
            <span className="tabular-nums text-foreground">
              {emails.filter((e) => e.ai_classified_at).length}/{emails.length}
            </span>
          </div>
        </div>
      </aside>

      {/* ── Middle: email list ── */}
      <section className="w-[420px] shrink-0 border-r flex flex-col min-w-0">
        {/* Search */}
        <div className="p-3 border-b">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search inbox…"
              className="w-full pl-8 pr-8 h-8 text-sm rounded-md bg-muted/40 border border-border/50 focus:outline-none focus:border-amber-500/50 focus:bg-background transition-colors"
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

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {isInboxZero ? (
            <InboxZero folder={folder} />
          ) : (
            <ul className="divide-y divide-border/40">
              {visibleEmails.map((email) => (
                <EmailRow
                  key={email.id}
                  email={email}
                  selected={email.id === selectedId}
                  onSelect={() => setSelectedId(email.id)}
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

      {/* ── Right: preview + reply ── */}
      <section className="flex-1 min-w-0 flex flex-col">
        {selected ? (
          <EmailPreview
            email={selected}
            customerNames={customerNames}
            subNames={subNames}
            projectNames={projectNames}
            onMarkDone={() => markDone(selected.id)}
            onDismiss={() => dismiss(selected.id)}
            onOpenInChat={() => openInChat(selected)}
          />
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
  );
}

/* ─── Email row ─── */

function EmailRow({
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
    <li
      onClick={onSelect}
      className={`group relative cursor-pointer border-l-2 ${urgencyBg} transition-colors ${
        selected ? "bg-amber-500/10" : "hover:bg-muted/40"
      } ${email.urgency === "junk" ? "opacity-60" : ""}`}
    >
      <div className="px-3 py-2.5 flex gap-2.5 min-w-0">
        {/* Avatar */}
        <div
          className={`h-8 w-8 shrink-0 rounded-full flex items-center justify-center text-[11px] font-semibold ${av.bg} ${av.text}`}
        >
          {initials(senderName, senderEmail)}
        </div>

        {/* Content */}
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

          {/* Chips */}
          {(projectName || customerName || subName || (email.attachments?.length ?? 0) > 0) && (
            <div className="flex gap-1 mt-1.5 flex-wrap">
              {projectName && (
                <span className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
                  <Briefcase className="h-2.5 w-2.5" />
                  {projectName}
                </span>
              )}
              {customerName && !projectName && (
                <span className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20">
                  <Users className="h-2.5 w-2.5" />
                  {customerName}
                </span>
              )}
              {subName && (
                <span className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-zinc-500/10 text-zinc-300 border border-zinc-500/20">
                  <HardHat className="h-2.5 w-2.5" />
                  {subName}
                </span>
              )}
              {(email.attachments?.length ?? 0) > 0 && (
                <span className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  <Paperclip className="h-2.5 w-2.5" />
                  {email.attachments.length}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Hover quick actions */}
      <div className="absolute right-2 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-1 bg-background border rounded-md shadow-sm">
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
    </li>
  );
}

/* ─── Email preview pane ─── */

function EmailPreview({
  email,
  customerNames,
  subNames,
  projectNames,
  onMarkDone,
  onDismiss,
  onOpenInChat,
}: {
  email: Email;
  customerNames: Record<string, string>;
  subNames: Record<string, string>;
  projectNames: Record<string, string>;
  onMarkDone: () => void;
  onDismiss: () => void;
  onOpenInChat: () => void;
}) {
  const [reply, setReply] = useState("");
  const senderName = email.from_name || email.from_email;
  const senderEmail = email.from_email;
  const av = avatarColor(senderEmail);
  const projectName = email.matched_project_id ? projectNames[email.matched_project_id] : null;
  const customerName = email.matched_customer_id ? customerNames[email.matched_customer_id] : null;
  const subName = email.matched_subcontractor_id ? subNames[email.matched_subcontractor_id] : null;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="px-5 py-4 border-b flex items-start gap-3">
        <div className={`h-10 w-10 shrink-0 rounded-full flex items-center justify-center text-sm font-semibold ${av.bg} ${av.text}`}>
          {initials(senderName, senderEmail)}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold flex items-center gap-2">
            {email.subject || "(no subject)"}
            {email.urgency === "urgent" && (
              <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 font-bold">
                <AlertCircle className="h-3 w-3" />
                URGENT
              </span>
            )}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            <span className="text-foreground/80">{senderName}</span>
            <span className="mx-1.5 opacity-40">·</span>
            {senderEmail}
            <span className="mx-1.5 opacity-40">·</span>
            {formatDate(email.date)}
          </p>
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
        <div className="flex gap-1 shrink-0">
          <button
            onClick={onMarkDone}
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
        <div className="px-5 py-2.5 bg-amber-500/5 border-b border-amber-500/20 flex items-start gap-2">
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
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div
          className="prose prose-sm prose-invert max-w-none text-sm text-foreground/80 whitespace-pre-wrap"
          dangerouslySetInnerHTML={{
            __html: (email.body || email.snippet || "").substring(0, 50000),
          }}
        />
        {email.attachments?.length > 0 && (
          <div className="mt-6 border-t pt-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
              Attachments ({email.attachments.length})
            </p>
            <div className="grid grid-cols-2 gap-2">
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

      {/* AI quick replies + composer */}
      <div className="border-t bg-muted/20">
        <div className="px-5 py-2.5 flex gap-1.5 flex-wrap border-b border-border/50">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground self-center mr-1">
            <Sparkles className="h-3 w-3 inline mr-1 text-amber-500/60" />
            Quick reply
          </span>
          {QUICK_REPLIES.map((r) => (
            <button
              key={r}
              onClick={() => setReply(r)}
              className="text-[11px] px-2 py-1 rounded-full bg-background border border-border/60 text-foreground/80 hover:border-amber-500/40 hover:bg-amber-500/5 transition-colors"
            >
              {r}
            </button>
          ))}
        </div>

        <div className="px-5 py-3 flex gap-2">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Write a reply, or pick one above…"
            rows={2}
            className="flex-1 px-3 py-2 text-sm rounded-md bg-background border border-border resize-none focus:outline-none focus:border-amber-500/50"
          />
          <div className="flex flex-col gap-1.5">
            <button
              disabled={!reply.trim()}
              onClick={onOpenInChat}
              className="px-3 py-2 rounded-md bg-amber-500 text-black text-xs font-medium hover:bg-amber-600 disabled:opacity-40 flex items-center gap-1"
              title="Open in AI chat (full editor)"
            >
              <Send className="h-3.5 w-3.5" />
              Send
            </button>
            <button
              onClick={onOpenInChat}
              className="px-3 py-2 rounded-md border text-muted-foreground hover:text-foreground hover:bg-muted text-xs flex items-center gap-1"
              title="Full triage chat"
            >
              <Reply className="h-3.5 w-3.5" />
              Chat
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
