"use client";

import { Button } from "@/components/ui/button";
import { updateTodoStatus } from "@/lib/actions/command-center";
import type { Todo } from "@/types/database";
import { useRouter } from "next/navigation";

interface ProjectDetailTodosProps {
  todos: Todo[];
}

export function ProjectDetailTodos({
  todos,
}: ProjectDetailTodosProps) {
  const router = useRouter();

  async function handleDone(id: string) {
    await updateTodoStatus(id, "done");
    router.refresh();
  }

  if (todos.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No open todos for this project.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {todos.map((todo) => (
        <div
          key={todo.id}
          className="rounded-lg border p-3 flex items-center justify-between gap-3"
        >
          <p className="text-sm flex-1">
            {todo.contact_name} &mdash; {todo.description}
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
            >
              Draft
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
      ))}
    </div>
  );
}
