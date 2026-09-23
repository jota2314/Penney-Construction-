"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardList, Copy, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { deleteSurvey, duplicateSurvey, type SurveyListRow } from "@/lib/actions/surveys";
import type { SurveyStatus } from "@/lib/surveys/types";

const STATUS_STYLE: Record<SurveyStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  active: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  closed: "bg-zinc-500/15 text-zinc-500",
};

export function StatusBadge({ status }: { status: SurveyStatus }) {
  return (
    <Badge variant="outline" className={cn("border-transparent capitalize", STATUS_STYLE[status])}>
      {status}
    </Badge>
  );
}

export function SurveyList({ surveys }: { surveys: SurveyListRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState<"all" | SurveyStatus>("all");

  const shown = filter === "all" ? surveys : surveys.filter((s) => s.status === filter);
  const counts = {
    all: surveys.length,
    active: surveys.filter((s) => s.status === "active").length,
    draft: surveys.filter((s) => s.status === "draft").length,
    closed: surveys.filter((s) => s.status === "closed").length,
  };
  const totalResponses = surveys.reduce((n, s) => n + s.response_count, 0);

  function onDuplicate(id: string) {
    startTransition(async () => {
      const res = await duplicateSurvey(id);
      if (res.id) router.push(`/surveys/${res.id}/edit`);
    });
  }
  function onDelete(s: SurveyListRow) {
    if (!confirm(`Delete "${s.title}" and its ${s.response_count} response(s)? This cannot be undone.`)) return;
    startTransition(async () => {
      await deleteSurvey(s.id);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Active</p>
          <p className="text-2xl font-semibold">{counts.active}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Responses</p>
          <p className="text-2xl font-semibold">{totalResponses}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Drafts</p>
          <p className="text-2xl font-semibold">{counts.draft}</p>
        </Card>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-1">
          {(["all", "active", "draft", "closed"] as const).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "default" : "ghost"}
              onClick={() => setFilter(f)}
              className="capitalize"
            >
              {f} <span className="opacity-60">{counts[f]}</span>
            </Button>
          ))}
        </div>
        <Button asChild>
          <Link href="/surveys/new">
            <Plus className="h-4 w-4" /> New survey
          </Link>
        </Button>
      </div>

      {shown.length === 0 ? (
        <Card className="p-10 text-center">
          <ClipboardList className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="font-medium">No surveys yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            Build one from a template: client satisfaction, pre-construction intake, or sub feedback.
          </p>
          <Button asChild className="mt-4">
            <Link href="/surveys/new">Create your first survey</Link>
          </Button>
        </Card>
      ) : (
        <div className="space-y-2">
          {shown.map((s) => (
            <Card key={s.id} className={cn("p-0 overflow-hidden", pending && "opacity-70")}>
              <div className="flex items-center gap-3 p-3 sm:p-4">
                <Link href={`/surveys/${s.id}`} className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium truncate">{s.title}</p>
                    <StatusBadge status={s.status} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {s.questions.length} question{s.questions.length === 1 ? "" : "s"}
                    {s.project_number ? ` · ${s.project_number} ${s.project_name ?? ""}` : ""}
                    {" · updated "}
                    {new Date(s.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </p>
                </Link>
                <div className="text-right shrink-0">
                  <p className="text-lg font-semibold leading-none">{s.response_count}</p>
                  <p className="text-[11px] text-muted-foreground">responses</p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="More">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onDuplicate(s.id)}>
                      <Copy className="h-4 w-4" /> Duplicate
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onDelete(s)} className="text-destructive">
                      <Trash2 className="h-4 w-4" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
