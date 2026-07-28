"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, Check, Loader2, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { ISSUE_TERM_LABELS } from "@/lib/constants/eos";
import {
  createIssue,
  createTodo,
  deleteIssue,
  setIssuePriority,
  setIssueStatus,
  solveIssue,
} from "@/lib/actions/eos-issues";
import type { EosIssue, EosIssueTerm, EosPerson } from "@/types/eos";
import { cn } from "@/lib/utils";

const UNASSIGNED = "unassigned";

const SOURCE_LABELS: Record<string, string> = {
  manual: "Added",
  scorecard: "Off goal",
  rock: "Off-track Rock",
  todo: "Carried to-do",
  headline: "Headline",
};

export function IssuesList({
  issues,
  people,
  /** In the L10 runner the top-three vote and solve buttons matter; on the
   *  standalone page it is just a list you groom between meetings. */
  meetingId,
  compact = false,
}: {
  issues: EosIssue[];
  people: EosPerson[];
  meetingId?: string | null;
  compact?: boolean;
}) {
  const [tab, setTab] = useState<"open" | "resolved">("open");
  const [creating, setCreating] = useState(false);

  const open = issues.filter((i) => i.status === "open");
  const resolved = issues.filter((i) => i.status !== "open");
  const shown = tab === "open" ? open : resolved;

  const shortTerm = shown.filter((i) => i.term === "short_term");
  const longTerm = shown.filter((i) => i.term === "long_term");

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {compact ? (
          <p className="text-sm text-muted-foreground">
            Vote the top three, then solve them one at a time. Every solve
            becomes a to-do.
          </p>
        ) : (
          <Tabs value={tab} onValueChange={(v) => setTab(v as "open" | "resolved")}>
            <TabsList>
              <TabsTrigger value="open">Open ({open.length})</TabsTrigger>
              <TabsTrigger value="resolved">Resolved ({resolved.length})</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
        <Button onClick={() => setCreating(true)} size={compact ? "sm" : "default"} className="gap-2">
          <Plus className="h-4 w-4" />
          Add issue
        </Button>
      </div>

      {shown.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {tab === "open" ? "Issues list is clear." : "Nothing resolved yet."}
          </CardContent>
        </Card>
      )}

      {shortTerm.length > 0 && (
        <div className="space-y-2">
          {!compact && longTerm.length > 0 && (
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Short term
            </h3>
          )}
          {shortTerm.map((issue) => (
            <IssueRow
              key={issue.id}
              issue={issue}
              people={people}
              meetingId={meetingId}
            />
          ))}
        </div>
      )}

      {longTerm.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Long term — parked for the V/TO
          </h3>
          {longTerm.map((issue) => (
            <IssueRow
              key={issue.id}
              issue={issue}
              people={people}
              meetingId={meetingId}
            />
          ))}
        </div>
      )}

      {creating && (
        <IssueDialog
          people={people}
          meetingId={meetingId}
          onClose={() => setCreating(false)}
        />
      )}
    </>
  );
}

function IssueRow({
  issue,
  people,
  meetingId,
}: {
  issue: EosIssue;
  people: EosPerson[];
  meetingId?: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [solving, setSolving] = useState(false);

  const isOpen = issue.status === "open";

  return (
    <Card className={cn(issue.priority && "border-amber-500/50")}>
      <CardContent className="flex flex-wrap items-start gap-3 p-3">
        {isOpen && (
          <div className="flex shrink-0 gap-1">
            {([1, 2, 3] as const).map((slot) => (
              <button
                key={slot}
                aria-label={`Mark as priority ${slot}`}
                aria-pressed={issue.priority === slot}
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await setIssuePriority(
                      issue.id,
                      issue.priority === slot ? null : slot,
                    );
                  })
                }
                className={cn(
                  "h-7 w-7 rounded-md border text-xs font-semibold transition-colors",
                  issue.priority === slot
                    ? "border-amber-500 bg-amber-500 text-white"
                    : "border-border text-muted-foreground hover:border-amber-500/60 hover:text-foreground",
                )}
              >
                {slot}
              </button>
            ))}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <p className={cn("text-sm font-medium", !isOpen && "text-muted-foreground")}>
            {issue.title}
          </p>
          {issue.description && (
            <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">
              {issue.description}
            </p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>{issue.ownerName ?? "Unassigned"}</span>
            {issue.source !== "manual" && (
              <Badge variant="secondary" className="text-[10px]">
                {SOURCE_LABELS[issue.source] ?? issue.source}
              </Badge>
            )}
            {issue.term === "long_term" && (
              <Badge variant="outline" className="text-[10px]">
                {ISSUE_TERM_LABELS.long_term}
              </Badge>
            )}
            {issue.status === "solved" && (
              <Badge
                variant="outline"
                className="border-emerald-500/30 bg-emerald-500/15 text-[10px] text-emerald-500"
              >
                Solved
              </Badge>
            )}
            {issue.status === "dropped" && (
              <Badge variant="outline" className="text-[10px]">
                Dropped
              </Badge>
            )}
          </div>
          {issue.solution && (
            <p className="mt-1.5 rounded-md bg-muted/50 p-2 text-xs">
              <span className="font-medium">Solve: </span>
              {issue.solution}
            </p>
          )}
        </div>

        <div className="flex shrink-0 gap-1">
          {isOpen ? (
            <>
              <Button
                size="sm"
                variant="secondary"
                className="h-7 gap-1 text-xs"
                onClick={() => setSolving(true)}
              >
                <Check className="h-3.5 w-3.5" />
                Solve
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                title="Drop this issue"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await setIssueStatus(issue.id, "dropped");
                  })
                }
              >
                <X className="h-3.5 w-3.5" />
                <span className="sr-only">Drop issue</span>
              </Button>
            </>
          ) : (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              title="Reopen"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await setIssueStatus(issue.id, "open");
                })
              }
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span className="sr-only">Reopen issue</span>
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-red-500 hover:text-red-500"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await deleteIssue(issue.id);
              })
            }
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span className="sr-only">Delete issue</span>
          </Button>
        </div>

        {solving && (
          <SolveDialog
            issue={issue}
            people={people}
            meetingId={meetingId}
            onClose={() => setSolving(false)}
          />
        )}
      </CardContent>
    </Card>
  );
}

function SolveDialog({
  issue,
  people,
  meetingId,
  onClose,
}: {
  issue: EosIssue;
  people: EosPerson[];
  meetingId?: string | null;
  onClose: () => void;
}) {
  const [solution, setSolution] = useState("");
  const [todoTitle, setTodoTitle] = useState("");
  const [todoOwner, setTodoOwner] = useState(issue.ownerId ?? UNASSIGNED);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await solveIssue(issue.id, solution, meetingId ?? null);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      // A solve that nobody owns an action on is not solved.
      const title = todoTitle.trim();
      if (title) {
        await createTodo({
          title,
          ownerProfileId: todoOwner === UNASSIGNED ? null : todoOwner,
          meetingId: meetingId ?? null,
        });
      }
      onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Solve — {issue.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="solve-note">What did the team decide?</Label>
            <Textarea
              id="solve-note"
              value={solution}
              onChange={(e) => setSolution(e.target.value)}
              rows={3}
            />
          </div>

          <div className="space-y-1.5 rounded-lg border p-3">
            <Label htmlFor="solve-todo">
              Resulting to-do <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="solve-todo"
              value={todoTitle}
              onChange={(e) => setTodoTitle(e.target.value)}
              placeholder="e.g. Send Chuck the written price by Friday"
            />
            <Select value={todoOwner} onValueChange={setTodoOwner}>
              <SelectTrigger className="mt-2">
                <SelectValue placeholder="Owner" />
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
            <p className="text-xs text-muted-foreground">Due in 7 days.</p>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Mark solved
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IssueDialog({
  people,
  meetingId,
  onClose,
}: {
  people: EosPerson[];
  meetingId?: string | null;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ownerId, setOwnerId] = useState(UNASSIGNED);
  const [term, setTerm] = useState<EosIssueTerm>("short_term");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await createIssue({
        title,
        description: description || null,
        ownerProfileId: ownerId === UNASSIGNED ? null : ownerId,
        term,
        source: "manual",
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add issue</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="issue-title">Issue</Label>
            <Input
              id="issue-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="State the real issue, not the symptom"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="issue-desc">Detail</Label>
            <Textarea
              id="issue-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="issue-owner">Owner</Label>
              <Select value={ownerId} onValueChange={setOwnerId}>
                <SelectTrigger id="issue-owner">
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
              <Label htmlFor="issue-term">Term</Label>
              <Select value={term} onValueChange={(v) => setTerm(v as EosIssueTerm)}>
                <SelectTrigger id="issue-term">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="short_term">
                    {ISSUE_TERM_LABELS.short_term} — solve at an L10
                  </SelectItem>
                  <SelectItem value="long_term">
                    {ISSUE_TERM_LABELS.long_term} — park for the V/TO
                  </SelectItem>
                </SelectContent>
              </Select>
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
