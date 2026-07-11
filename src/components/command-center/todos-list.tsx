"use client";

import { useState, useRef, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TodoChatInput } from "@/components/command-center/todo-chat-input";
import { EmailAutocomplete } from "@/components/ui/email-autocomplete";
import {
  updateTodoStatus,
  updateTodo,
  snoozeTodo,
  createTodo,
} from "@/lib/actions/command-center";
import type { Todo, TodoCategory, TodoPriority } from "@/types/database";
import { useRouter } from "next/navigation";
import { renderInlineMarkdown } from "@/lib/chat-markdown";

// ── Chat types ──────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  draft_email?: {
    to_email: string;
    to_name: string;
    cc?: string;
    subject: string;
    body: string;
  };
  schedule_meeting?: {
    name: string;
    start_time: string;
    end_time?: string;
    location?: string;
    description?: string;
    attendees?: string[];
    with_meet_link?: boolean;
  };
  assign_workers?: {
    employee_ids: string[];
    employee_names: string[];
    phase_name?: string;
    start_date?: string;
    end_date?: string;
  };
  new_todos?: {
    description: string;
    contact_name: string;
    category: string;
    priority: string;
  }[];
}

type ActionStatus = "idle" | "loading" | "success" | "error";
interface ActionState {
  status: ActionStatus;
  message?: string;
}

// ── Constants ──────────────────────────────────────

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "bg-red-500/20 text-red-400 border-red-500/30",
  high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  low: "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

const CATEGORY_CONFIG: {
  key: TodoCategory | "all";
  label: string;
  icon: string;
}[] = [
  { key: "all", label: "All", icon: "📋" },
  { key: "quotes", label: "Quotes", icon: "💰" },
  { key: "estimates", label: "Estimates", icon: "📐" },
  { key: "scheduling", label: "Scheduling", icon: "📅" },
  { key: "follow_up_quotes", label: "Follow-up (Quotes)", icon: "🔄" },
  { key: "follow_up_clients", label: "Follow-up (Clients)", icon: "📞" },
  { key: "permits_inspections", label: "Permits", icon: "📋" },
  { key: "materials", label: "Materials", icon: "🏗️" },
  { key: "change_orders", label: "Change Orders", icon: "📝" },
  { key: "payments", label: "Payments", icon: "💳" },
  { key: "contracts_docs", label: "Contracts", icon: "📄" },
  { key: "punch_list", label: "Punch List", icon: "✅" },
  { key: "general", label: "General", icon: "⚡" },
];

const CATEGORY_COLORS: Record<string, string> = {
  quotes: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  estimates: "bg-violet-500/20 text-violet-400 border-violet-500/30",
  scheduling: "bg-sky-500/20 text-sky-400 border-sky-500/30",
  follow_up_quotes: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  follow_up_clients: "bg-pink-500/20 text-pink-400 border-pink-500/30",
  permits_inspections: "bg-teal-500/20 text-teal-400 border-teal-500/30",
  materials: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  change_orders: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
  payments: "bg-green-500/20 text-green-400 border-green-500/30",
  contracts_docs: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  punch_list: "bg-rose-500/20 text-rose-400 border-rose-500/30",
  general: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

const TEAM_MEMBERS = ["Ryan", "Jorge", "Nicole", "Howie", "Shannon"];

interface TodosListProps {
  todos: Todo[];
  projects?: { id: string; name: string }[];
  currentUserId?: string;
  currentUserName?: string;
  initialShowCreate?: boolean;
  /** Deep link (?ai=<todoId>): auto-expand this todo and kick off the AI chat. */
  initialAiTodoId?: string;
}

// "mine" = anything assigned to the current user, plus anything they created
//          that hasn't been assigned to someone else yet.
// "unassigned" = no assignee, and not created by current user (i.e. genuinely orphan).
// "all" = everything.
// Anything else is treated as a literal first-name string from TEAM_MEMBERS.
type AssigneeFilter = "mine" | "all" | "unassigned" | string;

// ── Main Component ──────────────────────────────────────

export function TodosList({
  todos,
  projects,
  currentUserId,
  currentUserName,
  initialShowCreate = false,
  initialAiTodoId,
}: TodosListProps) {
  const router = useRouter();
  const [categoryFilter, setCategoryFilter] = useState<
    TodoCategory | "all"
  >("all");
  // Default to "mine" — show only the current user's todos by default.
  // A deep-linked AI todo may belong to anyone, so start on "all" then.
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilter>(
    initialAiTodoId ? "all" : "mine"
  );
  const [showCreate, setShowCreate] = useState(initialShowCreate);
  const [expandedTodo, setExpandedTodo] = useState<string | null>(null);
  const [snoozeId, setSnoozeId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  // Per-todo chat conversations: { todoId: ChatMessage[] }
  const [chatsByTodo, setChatsByTodo] = useState<
    Record<string, ChatMessage[]>
  >({});
  const [chatLoading, setChatLoading] = useState<string | null>(null);

  const open = todos.filter((t) => t.status === "open");
  const done = todos.filter((t) => t.status === "done");
  const snoozed = todos.filter((t) => t.status === "snoozed");

  // Helper: matches "mine" — assigned to me, OR unassigned + created by me.
  function isMine(t: Todo): boolean {
    if (currentUserName && t.assignee && t.assignee.toLowerCase() === currentUserName.toLowerCase()) return true;
    if (!t.assignee && currentUserId && t.created_by === currentUserId) return true;
    return false;
  }

  function matchesAssigneeFilter(t: Todo): boolean {
    switch (assigneeFilter) {
      case "all":
        return true;
      case "mine":
        return isMine(t);
      case "unassigned":
        return !t.assignee;
      default:
        return !!t.assignee && t.assignee.toLowerCase() === assigneeFilter.toLowerCase();
    }
  }

  const assigneeFiltered = open.filter(matchesAssigneeFilter);
  const filtered =
    categoryFilter === "all"
      ? assigneeFiltered
      : assigneeFiltered.filter((t) => t.category === categoryFilter);

  // Count per category — based on the assignee-filtered view so the chip
  // counts reflect what you'd actually see when toggling categories.
  const categoryCounts: Record<string, number> = { all: assigneeFiltered.length };
  assigneeFiltered.forEach((t) => {
    categoryCounts[t.category] = (categoryCounts[t.category] || 0) + 1;
  });

  // Counts for the assignee filter pills — based on ALL open todos.
  const mineCount = open.filter(isMine).length;
  const unassignedCount = open.filter((t) => !t.assignee).length;
  const personCounts: Record<string, number> = {};
  open.forEach((t) => {
    if (t.assignee) {
      const key = t.assignee.toLowerCase();
      personCounts[key] = (personCounts[key] || 0) + 1;
    }
  });

  const today = new Date().toISOString().split("T")[0];

  async function handleDone(id: string) {
    await updateTodoStatus(id, "done");
    router.refresh();
  }

  async function handleSnooze(id: string, until: string) {
    await snoozeTodo(id, new Date(until).toISOString());
    setSnoozeId(null);
    router.refresh();
  }

  async function handleAiAction(
    todoId: string,
    action: "draft_email" | "summarize" | "suggest_next"
  ) {
    setChatLoading(todoId);
    setExpandedTodo(todoId);
    try {
      const res = await fetch("/api/todo-ai-execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ todoId, action }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      // Build the initial user message for context
      const actionLabels: Record<string, string> = {
        draft_email: "Draft an email for this todo",
        summarize: "Summarize the context for this todo",
        suggest_next: "What should I do next?",
      };

      // Extract draft_email — try structured field, fallback to message content
      let draftEmail = data.result?.draft_email as ChatMessage["draft_email"];
      const msgText = (data.result?.message as string) || "";

      // If action was draft_email but AI didn't return structured draft_email,
      // use the message content as the email body
      if (!draftEmail && action === "draft_email" && msgText) {
        const thisTodo = todos.find((t) => t.id === todoId);
        draftEmail = {
          to_email: "",
          to_name: thisTodo?.contact_name || "",
          subject: `Re: ${thisTodo?.description?.substring(0, 60) || ""}`,
          body: msgText.replace(/\\n/g, "\n"),
        };
      }

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: draftEmail
          ? "Here's a draft email. Edit any field, add CC, then hit Send."
          : msgText || "Here's what I found:",
        draft_email: draftEmail,
        schedule_meeting: data.result?.schedule_meeting as ChatMessage["schedule_meeting"],
        assign_workers: data.result?.assign_workers as ChatMessage["assign_workers"],
        new_todos: data.result?.new_todos as ChatMessage["new_todos"],
      };

      setChatsByTodo((prev) => ({
        ...prev,
        [todoId]: [
          { role: "user", content: actionLabels[action] },
          assistantMsg,
        ],
      }));

      if (action === "summarize") router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "AI action failed");
    } finally {
      setChatLoading(null);
    }
  }

  // Deep link from the command-center Todos popup: expand the todo and let
  // the AI suggest how to knock it out. Runs once per page load.
  const aiAutoStarted = useRef(false);
  useEffect(() => {
    if (aiAutoStarted.current || !initialAiTodoId) return;
    if (!todos.some((t) => t.id === initialAiTodoId)) return;
    aiAutoStarted.current = true;
    handleAiAction(initialAiTodoId, "suggest_next");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAiTodoId, todos]);

  async function handleChatSend(todoId: string, userMessage: string) {
    const existing = chatsByTodo[todoId] || [];
    const updatedMessages = [
      ...existing,
      { role: "user" as const, content: userMessage },
    ];
    setChatsByTodo((prev) => ({ ...prev, [todoId]: updatedMessages }));
    setChatLoading(todoId);

    try {
      const res = await fetch("/api/todo-ai-execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          todoId,
          action: "chat",
          messages: updatedMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      // Check for draft email in chat response
      let chatDraft = data.result?.draft_email as ChatMessage["draft_email"];
      const chatText =
        (data.result?.message as string) ||
        (data.assistantMessage as string) ||
        "I'm not sure how to help with that.";

      // Detect if user asked for email and AI put it in message text
      const wantsEmail = /email|draft|write|send|compose|reply/i.test(userMessage);
      if (!chatDraft && wantsEmail && chatText) {
        const hasGreeting = /^(Hi|Hello|Dear|Hey)\s/im.test(chatText);
        const hasSign = /(Jorge|Best|Thanks|Regards|Sincerely)/im.test(chatText);
        if (hasGreeting && hasSign) {
          const thisTodo = todos.find((t) => t.id === todoId);
          chatDraft = {
            to_email: "",
            to_name: thisTodo?.contact_name || "",
            subject: "",
            body: chatText.replace(/\\n/g, "\n"),
          };
        }
      }

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: chatDraft
          ? "Here's the email. Edit and send when ready."
          : chatText,
        draft_email: chatDraft,
        schedule_meeting: data.result?.schedule_meeting as ChatMessage["schedule_meeting"],
        assign_workers: data.result?.assign_workers as ChatMessage["assign_workers"],
        new_todos: data.result?.new_todos as ChatMessage["new_todos"],
      };

      setChatsByTodo((prev) => ({
        ...prev,
        [todoId]: [...(prev[todoId] || []), assistantMsg],
      }));
    } catch (err) {
      alert(err instanceof Error ? err.message : "AI chat failed");
    } finally {
      setChatLoading(null);
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold">Todos</h3>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {filtered.length} open
          </span>
          <Button
            size="sm"
            onClick={() => setShowCreate(!showCreate)}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            + New
          </Button>
        </div>
      </div>

      {/* Create Form */}
      {showCreate && (
        <CreateTodoForm
          projects={projects}
          defaultAssignee={currentUserName}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            router.refresh();
          }}
        />
      )}

      {/* Assignee filter pills */}
      <div className="flex gap-2 mb-2 overflow-x-auto pb-1">
        <FilterPill
          label="Mine"
          count={mineCount}
          active={assigneeFilter === "mine"}
          onClick={() => setAssigneeFilter("mine")}
        />
        <FilterPill
          label="All"
          count={open.length}
          active={assigneeFilter === "all"}
          onClick={() => setAssigneeFilter("all")}
        />
        {unassignedCount > 0 && (
          <FilterPill
            label="Unassigned"
            count={unassignedCount}
            active={assigneeFilter === "unassigned"}
            onClick={() => setAssigneeFilter("unassigned")}
          />
        )}
        {TEAM_MEMBERS.filter(
          (name) =>
            // Don't show a pill for the current user — that's "Mine".
            name.toLowerCase() !== (currentUserName || "").toLowerCase() &&
            (personCounts[name.toLowerCase()] || 0) > 0
        ).map((name) => (
          <FilterPill
            key={name}
            label={name}
            count={personCounts[name.toLowerCase()] || 0}
            active={assigneeFilter.toLowerCase() === name.toLowerCase()}
            onClick={() => setAssigneeFilter(name)}
          />
        ))}
      </div>

      {/* Category filter chips */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        {CATEGORY_CONFIG.filter(
          (c) => c.key === "all" || (categoryCounts[c.key] || 0) > 0
        ).map((c) => (
          <button
            key={c.key}
            onClick={() => setCategoryFilter(c.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors whitespace-nowrap ${
              categoryFilter === c.key
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground border-border hover:text-foreground"
            }`}
          >
            {c.label} ({categoryCounts[c.key] || 0})
          </button>
        ))}
      </div>

      {/* Todo list */}
      {filtered.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          {assigneeFilter === "mine" && categoryFilter === "all"
            ? "Nothing on your plate. Switch to All to see the team's todos."
            : categoryFilter === "all"
              ? "Nothing here."
              : `No ${CATEGORY_CONFIG.find((c) => c.key === categoryFilter)?.label || categoryFilter} todos.`}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((todo) => (
            <TodoCard
              key={todo.id}
              todo={todo}
              today={today}
              expanded={expandedTodo === todo.id}
              onToggle={() =>
                setExpandedTodo(
                  expandedTodo === todo.id ? null : todo.id
                )
              }
              onDone={() => handleDone(todo.id)}
              onAiAction={(action) => handleAiAction(todo.id, action)}
              onChatSend={(msg) => handleChatSend(todo.id, msg)}
              chatMessages={chatsByTodo[todo.id] || []}
              chatLoading={chatLoading === todo.id}
              snoozeOpen={snoozeId === todo.id}
              onSnoozeToggle={() =>
                setSnoozeId(snoozeId === todo.id ? null : todo.id)
              }
              onSnooze={(until) => handleSnooze(todo.id, until)}
              editOpen={editId === todo.id}
              onEditToggle={() =>
                setEditId(editId === todo.id ? null : todo.id)
              }
              onEdited={() => {
                setEditId(null);
                router.refresh();
              }}
            />
          ))}
        </div>
      )}

      {/* Snoozed section */}
      {snoozed.length > 0 && (
        <div className="mt-6">
          <h4 className="text-sm font-medium text-muted-foreground mb-2">
            Snoozed ({snoozed.length})
          </h4>
          <div className="space-y-1">
            {snoozed.map((todo) => (
              <div
                key={todo.id}
                className="rounded-lg border bg-card/50 p-3 flex items-center justify-between gap-3 opacity-70"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-lg">💤</span>
                  <span className="text-sm truncate">
                    {todo.contact_name} — {todo.description}
                  </span>
                  {todo.snooze_until && (
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      until{" "}
                      {new Date(todo.snooze_until).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await updateTodoStatus(todo.id, "open");
                    router.refresh();
                  }}
                >
                  Wake
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Completed section */}
      {done.length > 0 && (
        <div className="mt-6">
          <h4 className="text-sm font-medium text-muted-foreground mb-2">
            Completed ({done.length})
          </h4>
          <div className="space-y-1">
            {done.slice(0, 5).map((todo) => (
              <div
                key={todo.id}
                className="rounded-lg border bg-card/50 p-3 flex items-center gap-3 opacity-60"
              >
                <div className="h-2 w-2 rounded-full bg-emerald-400" />
                <span className="text-sm line-through">
                  {todo.contact_name} — {todo.description}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Todo Card ──────────────────────────────────────

function TodoCard({
  todo,
  today,
  expanded,
  onToggle,
  onDone,
  onAiAction,
  onChatSend,
  chatMessages,
  chatLoading,
  snoozeOpen,
  onSnoozeToggle,
  onSnooze,
  editOpen,
  onEditToggle,
  onEdited,
}: {
  todo: Todo;
  today: string;
  expanded: boolean;
  onToggle: () => void;
  onDone: () => void;
  onAiAction: (action: "draft_email" | "summarize" | "suggest_next") => void;
  onChatSend: (message: string) => void;
  chatMessages: ChatMessage[];
  chatLoading: boolean;
  snoozeOpen: boolean;
  onSnoozeToggle: () => void;
  onSnooze: (until: string) => void;
  editOpen: boolean;
  onEditToggle: () => void;
  onEdited: () => void;
}) {
  const chatEndRef = useRef<HTMLDivElement>(null);

  const isOverdue =
    todo.due_date && todo.due_date.split("T")[0] < today;
  const categoryLabel =
    CATEGORY_CONFIG.find((c) => c.key === todo.category)?.label || "General";
  const hasChat = chatMessages.length > 0;

  // Auto-scroll to bottom of chat
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatMessages.length]);

  function handleChatInput(message: string) {
    if (!message.trim() || chatLoading) return;
    onChatSend(message);
  }

  return (
    <>
      {/* Card row — click to open popup */}
      <div
        className={`rounded-lg border bg-card p-4 flex items-center justify-between gap-3 cursor-pointer hover:border-amber-500/30 transition-colors ${isOverdue ? "border-red-500/50" : ""}`}
        onClick={onToggle}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{todo.contact_name}</span>
            {todo.project_name && (
              <Badge
                variant="outline"
                className="text-[10px] bg-amber-500/20 text-amber-400 border-amber-500/30"
              >
                {todo.project_name.toUpperCase()}
              </Badge>
            )}
            <Badge
              variant="outline"
              className={`text-[10px] ${CATEGORY_COLORS[todo.category] || CATEGORY_COLORS.general}`}
            >
              {categoryLabel}
            </Badge>
            <Badge
              variant="outline"
              className={`text-[10px] ${PRIORITY_COLORS[todo.priority] || PRIORITY_COLORS.medium}`}
            >
              {todo.priority.toUpperCase()}
            </Badge>
            {isOverdue && (
              <Badge
                variant="outline"
                className="text-[10px] bg-red-500/20 text-red-400 border-red-500/30 animate-pulse"
              >
                OVERDUE
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {todo.description}
          </p>
          <div className="flex items-center gap-3 mt-1">
            {todo.due_date && (
              <span
                className={`text-xs ${isOverdue ? "text-red-400" : "text-muted-foreground"}`}
              >
                Due: {new Date(todo.due_date).toLocaleDateString()}
              </span>
            )}
            {todo.assignee && (
              <span className="text-xs text-muted-foreground">
                → {todo.assignee}
              </span>
            )}
          </div>
        </div>
        <div
          className="flex items-center gap-2 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <Button size="sm" variant="outline" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>

      {/* Popup Dialog — full screen on mobile, large on desktop */}
      <Dialog open={expanded} onOpenChange={(open) => { if (!open) onToggle(); }}>
        <DialogContent className="max-w-4xl w-[95vw] h-[90vh] sm:h-[85vh] flex flex-col p-0 gap-0 rounded-none sm:rounded-lg">
          {/* Header */}
          <DialogHeader className="px-5 pt-5 pb-3 border-b shrink-0">
            <div className="flex items-center gap-2 flex-wrap">
              <DialogTitle className="text-base">{todo.contact_name}</DialogTitle>
              {todo.project_name && (
                <Badge
                  variant="outline"
                  className="text-[10px] bg-amber-500/20 text-amber-400 border-amber-500/30"
                >
                  {todo.project_name.toUpperCase()}
                </Badge>
              )}
              <Badge
                variant="outline"
                className={`text-[10px] ${CATEGORY_COLORS[todo.category] || CATEGORY_COLORS.general}`}
              >
                {categoryLabel}
              </Badge>
              <Badge
                variant="outline"
                className={`text-[10px] ${PRIORITY_COLORS[todo.priority] || PRIORITY_COLORS.medium}`}
              >
                {todo.priority.toUpperCase()}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">{todo.description}</p>
          </DialogHeader>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3 min-h-0">
            {/* AI Action Buttons */}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
                disabled={chatLoading}
                onClick={() => onAiAction("draft_email")}
              >
                ✉️ Draft Email
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-sky-400 border-sky-500/30 hover:bg-sky-500/10"
                disabled={chatLoading}
                onClick={() => onAiAction("summarize")}
              >
                📊 Summarize
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-violet-400 border-violet-500/30 hover:bg-violet-500/10"
                disabled={chatLoading}
                onClick={() => onAiAction("suggest_next")}
              >
                💡 Suggest Next
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
                onClick={onSnoozeToggle}
              >
                💤 Snooze
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-gray-400 border-gray-500/30 hover:bg-gray-500/10"
                onClick={onEditToggle}
              >
                ✏️ Edit
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={onDone}
              >
                Done
              </Button>
            </div>

            {/* Snooze picker */}
            {snoozeOpen && (
              <div className="flex flex-wrap gap-2 p-2 rounded-lg bg-background border">
                {[
                  { label: "Tomorrow", days: 1 },
                  { label: "2 Days", days: 2 },
                  { label: "3 Days", days: 3 },
                  { label: "1 Week", days: 7 },
                  { label: "2 Weeks", days: 14 },
                ].map((opt) => (
                  <Button
                    key={opt.label}
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const d = new Date();
                      d.setDate(d.getDate() + opt.days);
                      d.setHours(8, 0, 0, 0);
                      onSnooze(d.toISOString());
                    }}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            )}

            {/* Edit form */}
            {editOpen && (
              <EditTodoForm todo={todo} onSaved={onEdited} />
            )}

            {/* AI Summary (cached, show only if no active chat) */}
            {todo.ai_summary && !hasChat && (
              <div className="p-3 rounded-lg bg-sky-500/10 border border-sky-500/20">
                <p className="text-xs font-medium text-sky-400 mb-1">
                  AI Summary
                </p>
                <p className="text-sm">{todo.ai_summary}</p>
              </div>
            )}

            {/* Chat messages */}
            {hasChat && (
              <div className="space-y-3">
                {chatMessages.map((msg, i) => (
                  <div key={i}>
                    {msg.role === "user" ? (
                      <div className="flex justify-end">
                        <div className="bg-amber-600/20 border border-amber-600/30 rounded-lg px-3 py-2 max-w-[85%]">
                          <p className="text-sm">{msg.content}</p>
                        </div>
                      </div>
                    ) : (
                      <AssistantMessage
                        msg={msg}
                        msgIndex={i}
                        todoId={todo.id}
                        projectId={todo.project_id}
                      />
                    )}
                  </div>
                ))}

                {/* Loading indicator */}
                {chatLoading && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <div className="flex gap-1">
                      <div className="h-2 w-2 rounded-full bg-amber-400 animate-bounce [animation-delay:0ms]" />
                      <div className="h-2 w-2 rounded-full bg-amber-400 animate-bounce [animation-delay:150ms]" />
                      <div className="h-2 w-2 rounded-full bg-amber-400 animate-bounce [animation-delay:300ms]" />
                    </div>
                    <span className="text-xs">AI is thinking...</span>
                  </div>
                )}

                <div ref={chatEndRef} />
              </div>
            )}
          </div>

          {/* Chat input — pinned to bottom */}
          <div className="shrink-0">
            <TodoChatInput
              onSend={(msg) => handleChatInput(msg)}
              disabled={chatLoading}
              hasMessages={hasChat}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}


// ── Assistant Message with Action Buttons ──────────────────────────────

function AssistantMessage({
  msg,
  msgIndex,
  todoId,
  projectId,
}: {
  msg: ChatMessage;
  msgIndex: number;
  todoId: string;
  projectId: string | null;
}) {
  const [emailAction, setEmailAction] = useState<ActionState>({
    status: "idle",
  });
  const [meetingAction, setMeetingAction] = useState<ActionState>({
    status: "idle",
  });
  const [assignAction, setAssignAction] = useState<ActionState>({
    status: "idle",
  });

  // Attachment state
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [availableFiles, setAvailableFiles] = useState<
    {
      filename: string;
      storagePath: string;
      mimeType: string;
      size: number;
      bucket: string;
      source: string;
    }[]
  >([]);
  const [selectedFiles, setSelectedFiles] = useState<
    { filename: string; storagePath: string; mimeType: string; localContent?: string }[]
  >([]);
  const [filesLoading, setFilesLoading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleLocalUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1] || "";
        setSelectedFiles((prev) => [
          ...prev,
          {
            filename: file.name,
            storagePath: `local://${file.name}`,
            mimeType: file.type || "application/octet-stream",
            localContent: base64,
          },
        ]);
      };
      reader.readAsDataURL(file);
    });
    setShowFilePicker(false);
    e.target.value = "";
  }

  async function loadProjectFiles() {
    if (!projectId || availableFiles.length > 0) {
      setShowFilePicker(!showFilePicker);
      return;
    }
    setFilesLoading(true);
    setShowFilePicker(true);
    try {
      const res = await fetch("/api/todo-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "get_project_files",
          data: { project_id: projectId },
        }),
      });
      const data = await res.json();
      setAvailableFiles(data.files || []);
    } catch {
      // ignore
    } finally {
      setFilesLoading(false);
    }
  }

  function toggleFile(file: {
    filename: string;
    storagePath: string;
    mimeType: string;
  }) {
    setSelectedFiles((prev) => {
      const exists = prev.some((f) => f.storagePath === file.storagePath);
      if (exists) return prev.filter((f) => f.storagePath !== file.storagePath);
      return [...prev, file];
    });
  }

  // Editable email draft fields
  const [editTo, setEditTo] = useState(
    msg.draft_email
      ? msg.draft_email.to_name
        ? `${msg.draft_email.to_name} <${msg.draft_email.to_email}>`
        : msg.draft_email.to_email
      : ""
  );
  const [editCc, setEditCc] = useState(msg.draft_email?.cc || "");
  const [editSubject, setEditSubject] = useState(
    msg.draft_email?.subject || ""
  );
  const [editBody, setEditBody] = useState(msg.draft_email?.body || "");

  async function handleSendEmail() {
    if (!editTo || !editSubject || !editBody) return;

    // Parse "Name <email>" format
    const emailMatch = editTo.match(/<([^>]+)>/);
    const toEmail = emailMatch ? emailMatch[1] : editTo.trim();
    const toName = emailMatch
      ? editTo.replace(/<[^>]+>/, "").trim()
      : "";

    setEmailAction({ status: "loading" });
    try {
      const res = await fetch("/api/todo-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send_email",
          data: {
            to_email: toEmail,
            to_name: toName,
            subject: editSubject,
            body: editBody,
            cc: editCc || undefined,
            attachment_paths:
              selectedFiles.length > 0
                ? selectedFiles
                    .filter((f) => !f.localContent)
                    .map((f) => ({
                      storagePath: f.storagePath,
                      filename: f.filename,
                      mimeType: f.mimeType,
                    }))
                : undefined,
            local_attachments:
              selectedFiles.some((f) => f.localContent)
                ? selectedFiles
                    .filter((f) => f.localContent)
                    .map((f) => ({
                      filename: f.filename,
                      mimeType: f.mimeType,
                      content: f.localContent!,
                    }))
                : undefined,
          },
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setEmailAction({ status: "success", message: "Sent!" });
    } catch (err) {
      setEmailAction({
        status: "error",
        message: err instanceof Error ? err.message : "Failed to send",
      });
    }
  }

  async function handleScheduleMeeting() {
    if (!msg.schedule_meeting) return;
    setMeetingAction({ status: "loading" });
    try {
      const res = await fetch("/api/todo-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "schedule_meeting",
          data: msg.schedule_meeting,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const link = data.event?.link;
      const meet = data.event?.meetLink;
      setMeetingAction({
        status: "success",
        message: meet
          ? `Scheduled! Meet: ${meet}`
          : link
            ? `Scheduled! ${link}`
            : "Scheduled!",
      });
    } catch (err) {
      setMeetingAction({
        status: "error",
        message: err instanceof Error ? err.message : "Failed to schedule",
      });
    }
  }

  async function handleAssignWorkers() {
    if (!msg.assign_workers || !projectId) return;
    setAssignAction({ status: "loading" });
    try {
      const res = await fetch("/api/todo-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "assign_workers",
          data: { ...msg.assign_workers, project_id: projectId },
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setAssignAction({ status: "success", message: "Assigned!" });
    } catch (err) {
      setAssignAction({
        status: "error",
        message: err instanceof Error ? err.message : "Failed to assign",
      });
    }
  }

  return (
    <div className="space-y-2">
      <div className="bg-card border rounded-lg px-3 py-2">
        <p className="text-sm whitespace-pre-wrap">{renderInlineMarkdown(msg.content)}</p>
      </div>

      {/* Editable draft email with Send button */}
      {msg.draft_email && (
        <div className="ml-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-emerald-500/20">
            <p className="text-xs font-medium text-emerald-400">
              Draft Email
            </p>
            {emailAction.status === "success" ? (
              <span className="text-xs text-emerald-400 font-medium">
                {emailAction.message}
              </span>
            ) : (
              <Button
                size="sm"
                onClick={handleSendEmail}
                disabled={
                  emailAction.status === "loading" || !editTo || !editSubject
                }
                className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-7"
              >
                {emailAction.status === "loading"
                  ? "Sending..."
                  : "Send Email"}
              </Button>
            )}
          </div>
          {emailAction.status === "error" && (
            <p className="text-xs text-red-400 px-3 pt-2">
              {emailAction.message}
            </p>
          )}
          {/* Editable fields — all inputs are clickable and editable */}
          <div className="px-3 py-3 space-y-2.5 text-sm">
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-emerald-400 w-8 shrink-0">To:</label>
              <EmailAutocomplete
                value={editTo}
                onChange={setEditTo}
                placeholder="Start typing a name..."
                disabled={emailAction.status === "success"}
                className="flex-1 bg-background border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-emerald-400 w-8 shrink-0">CC:</label>
              <EmailAutocomplete
                value={editCc}
                onChange={setEditCc}
                placeholder="Start typing to add people..."
                disabled={emailAction.status === "success"}
                className="flex-1 bg-background border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-emerald-400 w-8 shrink-0">Subj:</label>
              <input
                type="text"
                value={editSubject}
                onChange={(e) => setEditSubject(e.target.value)}
                className="flex-1 bg-background border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                disabled={emailAction.status === "success"}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-emerald-400 mb-1 block">Body:</label>
              <textarea
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                rows={10}
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                disabled={emailAction.status === "success"}
              />
            </div>

            {/* Attachments */}
            {emailAction.status !== "success" && (
              <div>
                {/* Selected files */}
                {selectedFiles.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {selectedFiles.map((f) => (
                      <div
                        key={f.storagePath}
                        className="flex items-center gap-1 px-2 py-1 rounded bg-amber-500/10 border border-amber-500/20 text-xs"
                      >
                        <span className="truncate max-w-[150px]">
                          {f.filename}
                        </span>
                        <button
                          onClick={() => toggleFile(f)}
                          className="text-muted-foreground hover:text-red-400"
                        >
                          x
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Attach button */}
                {projectId && (
                  <div className="relative">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="text-xs h-7 gap-1"
                      onClick={loadProjectFiles}
                      disabled={filesLoading}
                    >
                      {filesLoading ? "Loading..." : "Attach Files"}
                    </Button>

                    {/* File picker dropdown */}
                    {showFilePicker && !filesLoading && (
                      <>
                        <div
                          className="fixed inset-0 z-10"
                          onClick={() => setShowFilePicker(false)}
                        />
                        <div className="absolute bottom-full left-0 mb-1 z-20 bg-background border rounded-lg shadow-lg p-2 min-w-[300px] max-w-[400px] max-h-60 overflow-y-auto">
                          {availableFiles.length > 0 ? (
                            availableFiles.map((file, i) => {
                              const isSelected = selectedFiles.some(
                                (f) => f.storagePath === file.storagePath
                              );
                              return (
                                <button
                                  key={i}
                                  onClick={() =>
                                    toggleFile({
                                      filename: file.filename,
                                      storagePath: file.storagePath,
                                      mimeType: file.mimeType,
                                    })
                                  }
                                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left ${
                                    isSelected
                                      ? "bg-emerald-500/20 text-emerald-400"
                                      : "hover:bg-muted"
                                  }`}
                                >
                                  <span
                                    className={`shrink-0 ${isSelected ? "text-emerald-400" : "text-muted-foreground"}`}
                                  >
                                    {isSelected ? "+" : "o"}
                                  </span>
                                  <span className="truncate flex-1">
                                    {file.filename}
                                  </span>
                                  <span className="text-muted-foreground shrink-0">
                                    {file.source}
                                  </span>
                                </button>
                              );
                            })
                          ) : (
                            <p className="text-xs text-muted-foreground px-2 py-1">
                              No project files found
                            </p>
                          )}

                          {/* Upload from computer */}
                          <div className="border-t mt-1 pt-1">
                            <button
                              onClick={() => fileInputRef.current?.click()}
                              className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted text-xs text-left font-medium"
                            >
                              <span className="text-blue-500 shrink-0">^</span>
                              <span>Upload from computer</span>
                            </button>
                          </div>
                        </div>
                      </>
                    )}

                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={handleLocalUpload}
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.gif,.zip,.csv,.txt"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Schedule meeting with Book button */}
      {msg.schedule_meeting && (
        <div className="ml-2 p-3 rounded-lg bg-sky-500/10 border border-sky-500/20">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-sky-400">
              Meeting
            </p>
            {meetingAction.status === "success" ? (
              <span className="text-xs text-sky-400 font-medium">
                {meetingAction.message}
              </span>
            ) : (
              <Button
                size="sm"
                onClick={handleScheduleMeeting}
                disabled={meetingAction.status === "loading"}
                className="bg-sky-600 hover:bg-sky-700 text-white text-xs h-7"
              >
                {meetingAction.status === "loading"
                  ? "Scheduling..."
                  : "Schedule on Calendar"}
              </Button>
            )}
          </div>
          {meetingAction.status === "error" && (
            <p className="text-xs text-red-400 mb-2">
              {meetingAction.message}
            </p>
          )}
          <div className="text-sm space-y-1">
            <p className="font-medium">{msg.schedule_meeting.name}</p>
            <p>
              <span className="text-muted-foreground">When:</span>{" "}
              {new Date(msg.schedule_meeting.start_time).toLocaleString()}
              {msg.schedule_meeting.end_time &&
                ` — ${new Date(msg.schedule_meeting.end_time).toLocaleTimeString()}`}
            </p>
            {msg.schedule_meeting.location && (
              <p>
                <span className="text-muted-foreground">Where:</span>{" "}
                {msg.schedule_meeting.location}
              </p>
            )}
            {msg.schedule_meeting.attendees &&
              msg.schedule_meeting.attendees.length > 0 && (
                <p>
                  <span className="text-muted-foreground">
                    Attendees:
                  </span>{" "}
                  {msg.schedule_meeting.attendees.join(", ")}
                </p>
              )}
          </div>
        </div>
      )}

      {/* Assign workers with Assign button */}
      {msg.assign_workers && (
        <div className="ml-2 p-3 rounded-lg bg-orange-500/10 border border-orange-500/20">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-orange-400">
              Crew Assignment
            </p>
            {assignAction.status === "success" ? (
              <span className="text-xs text-orange-400 font-medium">
                {assignAction.message}
              </span>
            ) : projectId ? (
              <Button
                size="sm"
                onClick={handleAssignWorkers}
                disabled={assignAction.status === "loading"}
                className="bg-orange-600 hover:bg-orange-700 text-white text-xs h-7"
              >
                {assignAction.status === "loading"
                  ? "Assigning..."
                  : "Assign Crew"}
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">
                No project linked
              </span>
            )}
          </div>
          {assignAction.status === "error" && (
            <p className="text-xs text-red-400 mb-2">
              {assignAction.message}
            </p>
          )}
          <div className="text-sm space-y-1">
            {msg.assign_workers.phase_name && (
              <p className="font-medium">{msg.assign_workers.phase_name}</p>
            )}
            <p>
              <span className="text-muted-foreground">Crew:</span>{" "}
              {msg.assign_workers.employee_names.join(", ")}
            </p>
            {msg.assign_workers.start_date && (
              <p>
                <span className="text-muted-foreground">Dates:</span>{" "}
                {msg.assign_workers.start_date}
                {msg.assign_workers.end_date &&
                  ` — ${msg.assign_workers.end_date}`}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Suggested new todos */}
      {msg.new_todos && msg.new_todos.length > 0 && (
        <div className="ml-2 p-3 rounded-lg bg-violet-500/10 border border-violet-500/20">
          <p className="text-xs font-medium text-violet-400 mb-2">
            Suggested Todos
          </p>
          <div className="space-y-1">
            {msg.new_todos.map((t, j) => (
              <div
                key={j}
                className="text-sm p-2 rounded bg-background border flex items-center gap-2"
              >
                <Badge
                  variant="outline"
                  className={`text-[10px] ${CATEGORY_COLORS[t.category] || CATEGORY_COLORS.general}`}
                >
                  {t.category}
                </Badge>
                <span>
                  {t.contact_name}: {t.description}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Edit Todo Form ──────────────────────────────────────

function EditTodoForm({
  todo,
  onSaved,
}: {
  todo: Todo;
  onSaved: () => void;
}) {
  const [description, setDescription] = useState(todo.description);
  const [priority, setPriority] = useState(todo.priority);
  const [category, setCategory] = useState(todo.category);
  const [dueDate, setDueDate] = useState(
    todo.due_date ? todo.due_date.split("T")[0] : ""
  );
  const [assignee, setAssignee] = useState(todo.assignee || "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await updateTodo(todo.id, {
        description,
        priority,
        category,
        due_date: dueDate || null,
        assignee: assignee || null,
      });
      onSaved();
    } catch {
      alert("Failed to update todo");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-3 rounded-lg bg-background border space-y-3">
      <div>
        <label className="text-xs text-muted-foreground">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full mt-1 rounded-md border bg-card px-3 py-2 text-sm"
          rows={2}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground">Priority</label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as TodoPriority)}
            className="w-full mt-1 rounded-md border bg-card px-3 py-2 text-sm"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as TodoCategory)}
            className="w-full mt-1 rounded-md border bg-card px-3 py-2 text-sm"
          >
            {CATEGORY_CONFIG.filter((c) => c.key !== "all").map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Due Date</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full mt-1 rounded-md border bg-card px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Assign To</label>
          <select
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            className="w-full mt-1 rounded-md border bg-card px-3 py-2 text-sm"
          >
            <option value="">Unassigned</option>
            {TEAM_MEMBERS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <Button size="sm" variant="outline" onClick={onSaved}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={saving}
          className="bg-amber-600 hover:bg-amber-700 text-white"
          onClick={handleSave}
        >
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}

// ── Filter Pill ──────────────────────────────────────

function FilterPill({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors whitespace-nowrap ${
        active
          ? "bg-amber-600 text-white border-amber-600"
          : "bg-card text-muted-foreground border-border hover:text-foreground"
      }`}
    >
      {label} ({count})
    </button>
  );
}

// ── Create Todo Form ──────────────────────────────────────

function CreateTodoForm({
  projects,
  defaultAssignee,
  onClose,
  onCreated,
}: {
  projects?: { id: string; name: string }[];
  defaultAssignee?: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    try {
      const form = e.currentTarget;
      const formData = new FormData(form);
      await createTodo(formData);
      onCreated();
    } catch {
      alert("Failed to create todo");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border bg-card p-4 mb-4 space-y-3"
    >
      <h4 className="font-medium text-sm">New Todo</h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground">
            Contact Name *
          </label>
          <input
            name="contact_name"
            required
            className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm"
            placeholder="Who is this for?"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">
            Contact Type
          </label>
          <select
            name="contact_type"
            defaultValue="subcontractor"
            className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="subcontractor">Subcontractor</option>
            <option value="client">Client</option>
            <option value="internal">Internal</option>
          </select>
        </div>
      </div>
      <div>
        <label className="text-xs text-muted-foreground">
          Description *
        </label>
        <textarea
          name="description"
          required
          rows={2}
          className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm"
          placeholder="What needs to be done?"
        />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className="text-xs text-muted-foreground">Category</label>
          <select
            name="category"
            defaultValue="general"
            className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm"
          >
            {CATEGORY_CONFIG.filter((c) => c.key !== "all").map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Priority</label>
          <select
            name="priority"
            defaultValue="medium"
            className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Due Date</label>
          <input
            name="due_date"
            type="date"
            className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Assign To</label>
          <select
            name="assignee"
            defaultValue={
              defaultAssignee && TEAM_MEMBERS.some(
                (m) => m.toLowerCase() === defaultAssignee.toLowerCase()
              )
                ? TEAM_MEMBERS.find(
                    (m) => m.toLowerCase() === defaultAssignee.toLowerCase()
                  )
                : ""
            }
            className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="">Unassigned</option>
            {TEAM_MEMBERS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>
      {projects && projects.length > 0 && (
        <div>
          <label className="text-xs text-muted-foreground">Project</label>
          <select
            name="project_id"
            defaultValue=""
            className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm"
            onChange={(e) => {
              const proj = projects.find((p) => p.id === e.target.value);
              const nameInput = e.target.form?.querySelector(
                'input[name="project_name"]'
              ) as HTMLInputElement;
              if (nameInput) nameInput.value = proj?.name || "";
            }}
          >
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input type="hidden" name="project_name" />
        </div>
      )}
      <div className="flex gap-2 justify-end">
        <Button type="button" size="sm" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={saving}
          className="bg-amber-600 hover:bg-amber-700 text-white"
        >
          {saving ? "Creating..." : "Create Todo"}
        </Button>
      </div>
    </form>
  );
}
