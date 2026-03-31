"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { updateTodoStatus } from "@/lib/actions/command-center";
import type { Todo } from "@/types/database";
import { useRouter } from "next/navigation";

const CATEGORY_LABELS: Record<string, string> = {
  quotes: "Quotes",
  estimates: "Estimates",
  scheduling: "Scheduling",
  follow_up_quotes: "Follow-up (Quotes)",
  follow_up_clients: "Follow-up (Clients)",
  permits_inspections: "Permits",
  materials: "Materials",
  change_orders: "Change Orders",
  payments: "Payments",
  contracts_docs: "Contracts",
  general: "General",
};

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

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "bg-red-500/20 text-red-400 border-red-500/30",
  high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  low: "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

interface ProjectDetailTodosProps {
  todos: Todo[];
}

export function ProjectDetailTodos({ todos }: ProjectDetailTodosProps) {
  const router = useRouter();
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<{
    todoId: string;
    action: string;
    result: Record<string, unknown>;
  } | null>(null);

  async function handleDone(id: string) {
    await updateTodoStatus(id, "done");
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
    } catch (err) {
      alert(err instanceof Error ? err.message : "AI action failed");
    } finally {
      setAiLoading(null);
    }
  }

  if (todos.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No open todos for this project.
      </p>
    );
  }

  const today = new Date().toISOString().split("T")[0];

  return (
    <div className="space-y-2">
      {todos.map((todo) => {
        const isOverdue =
          todo.due_date && todo.due_date.split("T")[0] < today;
        const showAiResult =
          aiResult?.todoId === todo.id;

        return (
          <div
            key={todo.id}
            className={`rounded-lg border p-3 space-y-2 ${isOverdue ? "border-red-500/50" : ""}`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">
                    {todo.contact_name}
                  </span>
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${CATEGORY_COLORS[todo.category] || CATEGORY_COLORS.general}`}
                  >
                    {CATEGORY_LABELS[todo.category] || "General"}
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
                      className="text-[10px] bg-red-500/20 text-red-400 border-red-500/30"
                    >
                      OVERDUE
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {todo.description}
                </p>
                {(todo.due_date || todo.assignee) && (
                  <div className="flex gap-3 mt-1">
                    {todo.due_date && (
                      <span
                        className={`text-xs ${isOverdue ? "text-red-400" : "text-muted-foreground"}`}
                      >
                        Due:{" "}
                        {new Date(todo.due_date).toLocaleDateString()}
                      </span>
                    )}
                    {todo.assignee && (
                      <span className="text-xs text-muted-foreground">
                        → {todo.assignee}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
                  disabled={aiLoading !== null}
                  onClick={() => handleAiExecute(todo.id, "draft_email")}
                >
                  {aiLoading === `${todo.id}-draft_email`
                    ? "..."
                    : "Draft"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleDone(todo.id)}
                >
                  Done
                </Button>
              </div>
            </div>

            {/* AI Result */}
            {showAiResult && aiResult && (
              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-sm space-y-1">
                {aiResult.action === "draft_email" && (
                  <>
                    <p className="text-xs font-medium text-emerald-400">
                      Draft Email
                    </p>
                    <p>
                      <span className="text-muted-foreground">To:</span>{" "}
                      {(aiResult.result.to_name as string) || ""}{" "}
                      &lt;{(aiResult.result.to_email as string) || ""}&gt;
                    </p>
                    <p>
                      <span className="text-muted-foreground">
                        Subject:
                      </span>{" "}
                      {(aiResult.result.subject as string) || ""}
                    </p>
                    <div className="mt-2 p-2 rounded bg-background border whitespace-pre-wrap">
                      {(aiResult.result.body as string) || ""}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Cached AI Summary */}
            {todo.ai_summary && !showAiResult && (
              <p className="text-xs text-muted-foreground italic">
                {todo.ai_summary}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
