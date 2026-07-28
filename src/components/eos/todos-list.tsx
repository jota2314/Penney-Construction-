"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, Loader2, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  createTodo,
  deleteTodo,
  escalateTodoToIssue,
  setTodoStatus,
} from "@/lib/actions/eos-issues";
import type { EosPerson, EosTodo } from "@/types/eos";
import { cn } from "@/lib/utils";

const UNASSIGNED = "unassigned";

export function TodosList({
  todos,
  people,
  meetingId,
  compact = false,
}: {
  todos: EosTodo[];
  people: EosPerson[];
  meetingId?: string | null;
  compact?: boolean;
}) {
  const [tab, setTab] = useState<"open" | "closed">("open");
  const [creating, setCreating] = useState(false);

  const open = todos.filter((t) => t.status === "open");
  const closed = todos.filter((t) => t.status !== "open");
  const shown = compact || tab === "open" ? open : closed;

  // EOS target is 90% of to-dos done week to week.
  const doneCount = todos.filter((t) => t.status === "done").length;
  const completionBase = open.length + doneCount;
  const pct = completionBase
    ? Math.round((doneCount / completionBase) * 100)
    : null;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {compact ? (
          <p className="text-sm text-muted-foreground">
            Done or not done — no discussion. Not done becomes an issue.
          </p>
        ) : (
          <Tabs value={tab} onValueChange={(v) => setTab(v as "open" | "closed")}>
            <TabsList>
              <TabsTrigger value="open">Open ({open.length})</TabsTrigger>
              <TabsTrigger value="closed">Closed ({closed.length})</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
        <div className="flex items-center gap-3">
          {pct !== null && (
            <span
              className={cn(
                "text-sm font-medium tabular-nums",
                pct >= 90 ? "text-emerald-500" : "text-amber-500",
              )}
              title="EOS target is 90% done"
            >
              {pct}% done
            </span>
          )}
          <Button
            onClick={() => setCreating(true)}
            size={compact ? "sm" : "default"}
            className="gap-2"
          >
            <Plus className="h-4 w-4" />
            Add to-do
          </Button>
        </div>
      </div>

      {shown.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {tab === "open" || compact ? "No open to-dos." : "Nothing closed yet."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {shown.map((todo) => (
            <TodoRow key={todo.id} todo={todo} />
          ))}
        </div>
      )}

      {creating && (
        <TodoDialog
          people={people}
          meetingId={meetingId}
          onClose={() => setCreating(false)}
        />
      )}
    </>
  );
}

function TodoRow({ todo }: { todo: EosTodo }) {
  const [pending, startTransition] = useTransition();

  const today = new Date().toISOString().slice(0, 10);
  const overdue = todo.status === "open" && todo.dueDate && todo.dueDate < today;

  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-3">
        <Checkbox
          id={`todo-${todo.id}`}
          className="mt-0.5"
          checked={todo.status === "done"}
          disabled={pending}
          onCheckedChange={(checked) =>
            startTransition(async () => {
              await setTodoStatus(todo.id, checked === true ? "done" : "open");
            })
          }
        />
        <div className="min-w-0 flex-1">
          <label
            htmlFor={`todo-${todo.id}`}
            className={cn(
              "text-sm font-medium",
              todo.status !== "open" && "text-muted-foreground line-through",
            )}
          >
            {todo.title}
          </label>
          {todo.description && (
            <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">
              {todo.description}
            </p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>{todo.ownerName ?? "Unassigned"}</span>
            {todo.dueDate && (
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px]",
                  overdue && "border-red-500/30 bg-red-500/15 text-red-500",
                )}
              >
                due {todo.dueDate}
              </Badge>
            )}
            {todo.status === "dropped" && (
              <Badge variant="outline" className="text-[10px]">
                Dropped
              </Badge>
            )}
          </div>
        </div>

        <div className="flex shrink-0 gap-1">
          {todo.status === "open" && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              title="Not done — turn it into an issue"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await escalateTodoToIssue(todo.id);
                })
              }
            >
              <ArrowUpRight className="h-3.5 w-3.5" />
              <span className="sr-only">Escalate to issue</span>
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-red-500 hover:text-red-500"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await deleteTodo(todo.id);
              })
            }
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span className="sr-only">Delete to-do</span>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function TodoDialog({
  people,
  meetingId,
  onClose,
}: {
  people: EosPerson[];
  meetingId?: string | null;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [ownerId, setOwnerId] = useState(UNASSIGNED);
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await createTodo({
        title,
        ownerProfileId: ownerId === UNASSIGNED ? null : ownerId,
        dueDate: dueDate || null,
        meetingId: meetingId ?? null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add to-do</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="todo-title">To-do</Label>
            <Input
              id="todo-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="One clear action, one owner"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="todo-owner">Owner</Label>
              <Select value={ownerId} onValueChange={setOwnerId}>
                <SelectTrigger id="todo-owner">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                  {people.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="todo-due">Due</Label>
              <Input
                id="todo-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
