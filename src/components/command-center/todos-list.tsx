"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  updateTodoStatus,
  updateTodo,
  snoozeTodo,
  createTodo,
} from "@/lib/actions/command-center";
import type { Todo, TodoCategory, TodoPriority } from "@/types/database";
import { useRouter } from "next/navigation";

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
  general: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

const TEAM_MEMBERS = ["Ryan", "Jorge", "Nicole", "Howie", "Shannon"];

interface TodosListProps {
  todos: Todo[];
  projects?: { id: string; name: string }[];
}

// ── Main Component ──────────────────────────────────────

export function TodosList({ todos, projects }: TodosListProps) {
  const router = useRouter();
  const [categoryFilter, setCategoryFilter] = useState<
    TodoCategory | "all"
  >("all");
  const [showCreate, setShowCreate] = useState(false);
  const [expandedTodo, setExpandedTodo] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<{
    todoId: string;
    action: string;
    result: Record<string, unknown>;
  } | null>(null);
  const [snoozeId, setSnoozeId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);

  const open = todos.filter((t) => t.status === "open");
  const done = todos.filter((t) => t.status === "done");
  const snoozed = todos.filter((t) => t.status === "snoozed");

  const filtered =
    categoryFilter === "all"
      ? open
      : open.filter((t) => t.category === categoryFilter);

  // Count per category
  const categoryCounts: Record<string, number> = { all: open.length };
  open.forEach((t) => {
    categoryCounts[t.category] = (categoryCounts[t.category] || 0) + 1;
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

  async function handleAiExecute(
    todoId: string,
    action: "draft_email" | "summarize" | "suggest_next"
  ) {
    setAiLoading(`${todoId}-${action}`);
    setAiResult(null);
    try {
      const res = await fetch("/api/todo-ai-execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ todoId, action }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setAiResult({ todoId, action, result: data.result });
      setExpandedTodo(todoId);
      if (action === "summarize") router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "AI action failed");
    } finally {
      setAiLoading(null);
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
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            router.refresh();
          }}
        />
      )}

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
          {categoryFilter === "all"
            ? "All caught up! No open todos."
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
              onAiExecute={(action) => handleAiExecute(todo.id, action)}
              aiLoading={aiLoading}
              aiResult={
                aiResult?.todoId === todo.id ? aiResult : null
              }
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
  onAiExecute,
  aiLoading,
  aiResult,
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
  onAiExecute: (action: "draft_email" | "summarize" | "suggest_next") => void;
  aiLoading: string | null;
  aiResult: {
    todoId: string;
    action: string;
    result: Record<string, unknown>;
  } | null;
  snoozeOpen: boolean;
  onSnoozeToggle: () => void;
  onSnooze: (until: string) => void;
  editOpen: boolean;
  onEditToggle: () => void;
  onEdited: () => void;
}) {
  const isOverdue =
    todo.due_date && todo.due_date.split("T")[0] < today;
  const categoryLabel =
    CATEGORY_CONFIG.find((c) => c.key === todo.category)?.label || "General";

  return (
    <div
      className={`rounded-lg border bg-card overflow-hidden ${isOverdue ? "border-red-500/50" : ""}`}
    >
      {/* Main row */}
      <div
        className="p-4 flex items-center justify-between gap-3 cursor-pointer"
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

      {/* Expanded section */}
      {expanded && (
        <div className="border-t px-4 py-3 bg-card/50 space-y-3">
          {/* AI Action Buttons */}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
              disabled={aiLoading !== null}
              onClick={() => onAiExecute("draft_email")}
            >
              {aiLoading === `${todo.id}-draft_email`
                ? "Drafting..."
                : "✉️ Draft Email"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-sky-400 border-sky-500/30 hover:bg-sky-500/10"
              disabled={aiLoading !== null}
              onClick={() => onAiExecute("summarize")}
            >
              {aiLoading === `${todo.id}-summarize`
                ? "Summarizing..."
                : "📊 Summarize"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-violet-400 border-violet-500/30 hover:bg-violet-500/10"
              disabled={aiLoading !== null}
              onClick={() => onAiExecute("suggest_next")}
            >
              {aiLoading === `${todo.id}-suggest_next`
                ? "Thinking..."
                : "💡 Suggest Next"}
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

          {/* AI Summary (cached) */}
          {todo.ai_summary && !aiResult && (
            <div className="p-3 rounded-lg bg-sky-500/10 border border-sky-500/20">
              <p className="text-xs font-medium text-sky-400 mb-1">
                AI Summary
              </p>
              <p className="text-sm">{todo.ai_summary}</p>
            </div>
          )}

          {/* AI Result */}
          {aiResult && <AiResultDisplay result={aiResult} />}
        </div>
      )}
    </div>
  );
}

// ── AI Result Display ──────────────────────────────────────

function AiResultDisplay({
  result,
}: {
  result: {
    action: string;
    result: Record<string, unknown>;
  };
}) {
  const { action, result: data } = result;

  if (action === "draft_email") {
    return (
      <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 space-y-2">
        <p className="text-xs font-medium text-emerald-400">
          Draft Email
        </p>
        <div className="text-sm space-y-1">
          <p>
            <span className="text-muted-foreground">To:</span>{" "}
            {(data.to_name as string) || ""}{" "}
            &lt;{(data.to_email as string) || ""}&gt;
          </p>
          <p>
            <span className="text-muted-foreground">Subject:</span>{" "}
            {(data.subject as string) || ""}
          </p>
          <div className="mt-2 p-2 rounded bg-background border text-sm whitespace-pre-wrap">
            {(data.body as string) || ""}
          </div>
          {"reasoning" in data && data.reasoning ? (
            <p className="text-xs text-muted-foreground mt-2">
              {String(data.reasoning)}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  if (action === "summarize") {
    const keyFacts = (data.key_facts as string[]) || [];
    const timeline =
      (data.timeline as { date: string; event: string }[]) || [];
    return (
      <div className="p-3 rounded-lg bg-sky-500/10 border border-sky-500/20 space-y-2">
        <p className="text-xs font-medium text-sky-400">
          Context Summary
        </p>
        <p className="text-sm">{(data.summary as string) || ""}</p>
        {keyFacts.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mt-2">
              Key Facts
            </p>
            <ul className="text-sm list-disc list-inside">
              {keyFacts.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </div>
        )}
        {timeline.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mt-2">
              Timeline
            </p>
            <div className="text-sm space-y-1">
              {timeline.map((t, i) => (
                <p key={i}>
                  <span className="text-muted-foreground">
                    {t.date}
                  </span>{" "}
                  — {t.event}
                </p>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (action === "suggest_next") {
    const newTodos =
      (data.new_todos as {
        description: string;
        contact_name: string;
        category: string;
        priority: string;
      }[]) || [];
    return (
      <div className="p-3 rounded-lg bg-violet-500/10 border border-violet-500/20 space-y-2">
        <p className="text-xs font-medium text-violet-400">
          Suggested Next Step
        </p>
        <p className="text-sm">{(data.suggestion as string) || ""}</p>
        {newTodos.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mt-2">
              Suggested New Todos
            </p>
            <div className="space-y-1">
              {newTodos.map((t, i) => (
                <div
                  key={i}
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
        {"reasoning" in data && data.reasoning ? (
          <p className="text-xs text-muted-foreground mt-2">
            {String(data.reasoning)}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="p-3 rounded-lg bg-gray-500/10 border border-gray-500/20">
      <pre className="text-xs overflow-auto">
        {JSON.stringify(data, null, 2)}
      </pre>
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

// ── Create Todo Form ──────────────────────────────────────

function CreateTodoForm({
  projects,
  onClose,
  onCreated,
}: {
  projects?: { id: string; name: string }[];
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
            defaultValue=""
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
