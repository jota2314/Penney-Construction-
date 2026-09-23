"use client";

import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Copy, ExternalLink, Mail, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  deleteSurveyResponse,
  sendSurveyEmail,
  setSurveyStatus,
} from "@/lib/actions/surveys";
import {
  scaleRange,
  type Survey,
  type SurveyQuestion,
  type SurveyResponse,
} from "@/lib/surveys/types";
import { StatusBadge } from "./survey-list";

interface SurveyResultsProps {
  survey: Survey;
  responses: SurveyResponse[];
  project: { id: string; name: string; project_number: string } | null;
  customer: { id: string; first_name: string; last_name: string; email: string | null } | null;
}

export function SurveyResults({ survey, responses, project, customer }: SurveyResultsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const origin = useOrigin();
  const [copied, setCopied] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [view, setView] = useState<"summary" | "responses">("summary");

  const url = `${origin}/survey/${survey.public_token}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the link is visible to select manually */
    }
  }

  function changeStatus(status: Survey["status"]) {
    startTransition(async () => {
      await setSurveyStatus(survey.id, status);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold">{survey.title}</h2>
              <StatusBadge status={survey.status} />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {survey.questions.length} questions · {responses.length} response{responses.length === 1 ? "" : "s"}
              {survey.sent_count > 0 && ` · emailed ${survey.sent_count}×`}
              {project && (
                <>
                  {" · "}
                  <Link href={`/projects/${project.id}`} className="underline underline-offset-2">
                    {project.project_number} {project.name}
                  </Link>
                </>
              )}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button asChild variant="outline" size="sm">
              <Link href={`/surveys/${survey.id}/edit`}>
                <Pencil className="h-4 w-4" /> Edit
              </Link>
            </Button>
            {survey.status !== "active" ? (
              <Button size="sm" disabled={pending} onClick={() => changeStatus("active")}>
                {survey.status === "closed" ? "Reopen" : "Activate"}
              </Button>
            ) : (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => changeStatus("closed")}>
                Close survey
              </Button>
            )}
          </div>
        </div>

        <div className="mt-4 rounded-md border bg-muted/40 p-3">
          <p className="text-xs font-medium text-muted-foreground mb-1.5">Public link</p>
          <div className="flex gap-2 flex-wrap">
            <Input readOnly value={origin ? url : "…"} className="flex-1 min-w-[200px] font-mono text-xs" onFocus={(e) => e.target.select()} />
            <Button variant="outline" size="sm" onClick={copy}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : "Copy"}
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={url} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" /> Preview
              </a>
            </Button>
            <Button size="sm" onClick={() => setSendOpen(true)} disabled={survey.status === "closed"}>
              <Mail className="h-4 w-4" /> Send by email
            </Button>
          </div>
          {survey.status !== "active" && (
            <p className="text-xs text-amber-600 mt-2">
              The link shows &quot;not accepting responses&quot; until the survey is active. Sending by email activates it.
            </p>
          )}
        </div>
      </Card>

      <div className="flex gap-1">
        <Button size="sm" variant={view === "summary" ? "default" : "ghost"} onClick={() => setView("summary")}>
          Summary
        </Button>
        <Button size="sm" variant={view === "responses" ? "default" : "ghost"} onClick={() => setView("responses")}>
          Responses <span className="opacity-60">{responses.length}</span>
        </Button>
      </div>

      {responses.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          No responses yet. Share the link above or send it by email.
        </Card>
      ) : view === "summary" ? (
        <div className="space-y-3">
          {survey.questions.map((q, i) => (
            <QuestionSummary key={q.id} index={i} q={q} responses={responses} />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {responses.map((r) => (
            <ResponseCard key={r.id} r={r} survey={survey} />
          ))}
        </div>
      )}

      <SendDialog
        open={sendOpen}
        onOpenChange={setSendOpen}
        surveyId={survey.id}
        origin={origin}
        defaultTo={customer?.email ?? ""}
        defaultName={customer ? `${customer.first_name} ${customer.last_name}`.trim() : ""}
      />
    </div>
  );
}

const noop = () => () => {};
/** Browser origin, "" during SSR so the markup hydrates cleanly. */
function useOrigin() {
  return useSyncExternalStore(noop, () => window.location.origin, () => "");
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Bar({ label, count, total, highlight }: { label: string; count: number; total: number; highlight?: boolean }) {
  const pct = total ? Math.round((count / total) * 100) : 0;
  return (
    <div className="text-sm">
      <div className="flex justify-between gap-2">
        <span className="truncate">{label}</span>
        <span className="text-muted-foreground shrink-0">
          {count} · {pct}%
        </span>
      </div>
      <div className="h-2 rounded bg-muted mt-1 overflow-hidden">
        <div
          className={cn("h-full rounded", highlight ? "bg-amber-500" : "bg-amber-600/70")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function QuestionSummary({ index, q, responses }: { index: number; q: SurveyQuestion; responses: SurveyResponse[] }) {
  const values = useMemo(
    () => responses.map((r) => r.answers?.[q.id]).filter((v) => v !== null && v !== undefined && v !== ""),
    [responses, q.id],
  );
  const answered = values.length;

  let body: React.ReactNode;
  switch (q.type) {
    case "single_choice":
    case "multiple_choice":
    case "yes_no": {
      const opts = q.type === "yes_no" ? ["yes", "no"] : q.options ?? [];
      const counts = new Map<string, number>(opts.map((o) => [o, 0]));
      for (const v of values) {
        const arr = Array.isArray(v) ? v : [String(v)];
        for (const a of arr) counts.set(a, (counts.get(a) ?? 0) + 1);
      }
      const top = Math.max(0, ...counts.values());
      body = (
        <div className="space-y-2">
          {opts.map((o) => (
            <Bar key={o} label={q.type === "yes_no" ? (o === "yes" ? "Yes" : "No") : o} count={counts.get(o) ?? 0} total={answered} highlight={(counts.get(o) ?? 0) === top && top > 0} />
          ))}
        </div>
      );
      break;
    }
    case "rating":
    case "nps": {
      const nums = values.map((v) => Number(v)).filter((n) => Number.isFinite(n));
      const avg = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
      const [min, max] = scaleRange(q.type);
      const dist = new Map<number, number>();
      for (let n = min; n <= max; n++) dist.set(n, 0);
      for (const n of nums) dist.set(n, (dist.get(n) ?? 0) + 1);
      const peak = Math.max(0, ...dist.values());
      let nps: number | null = null;
      if (q.type === "nps" && nums.length) {
        const promoters = nums.filter((n) => n >= 9).length;
        const detractors = nums.filter((n) => n <= 6).length;
        nps = Math.round(((promoters - detractors) / nums.length) * 100);
      }
      body = (
        <div>
          <div className="flex items-baseline gap-4 mb-3">
            <div>
              <p className="text-2xl font-semibold leading-none">{avg.toFixed(1)}</p>
              <p className="text-[11px] text-muted-foreground mt-1">average of {max}</p>
            </div>
            {nps !== null && (
              <div>
                <p className={cn("text-2xl font-semibold leading-none", nps >= 50 ? "text-emerald-500" : nps < 0 ? "text-red-500" : "")}>{nps > 0 ? `+${nps}` : nps}</p>
                <p className="text-[11px] text-muted-foreground mt-1">NPS</p>
              </div>
            )}
          </div>
          <div className="flex items-end gap-1 h-16">
            {Array.from(dist.entries()).map(([n, c]) => (
              <div key={n} className="flex-1 flex flex-col items-center gap-1 h-full justify-end" title={`${n}: ${c}`}>
                <div
                  className={cn("w-full rounded-t", c === peak && peak > 0 ? "bg-amber-500" : "bg-amber-600/60")}
                  style={{ height: `${peak ? Math.max(4, (c / peak) * 100) : 4}%` }}
                />
                <span className="text-[10px] text-muted-foreground">{n}</span>
              </div>
            ))}
          </div>
        </div>
      );
      break;
    }
    default: {
      const texts = values.map(String);
      body = (
        <ul className="space-y-1.5 max-h-64 overflow-auto">
          {texts.map((t, i) => (
            <li key={i} className="text-sm rounded bg-muted/50 px-3 py-2 whitespace-pre-line">
              {t}
            </li>
          ))}
        </ul>
      );
    }
  }

  return (
    <Card className="p-4">
      <p className="text-sm font-medium mb-3">
        <span className="text-muted-foreground mr-2">{index + 1}.</span>
        {q.label}
        <span className="text-xs text-muted-foreground font-normal ml-2">
          {answered}/{responses.length} answered
        </span>
      </p>
      {answered === 0 ? <p className="text-sm text-muted-foreground">No answers</p> : body}
    </Card>
  );
}

function ResponseCard({ r, survey }: { r: SurveyResponse; survey: Survey }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const who = r.respondent_name || r.respondent_email || "Anonymous";

  function onDelete() {
    if (!confirm(`Delete this response from ${who}?`)) return;
    startTransition(async () => {
      await deleteSurveyResponse(r.id, survey.id);
      router.refresh();
    });
  }

  return (
    <Card className={cn("p-4", pending && "opacity-60")}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <p className="font-medium truncate">{who}</p>
          <p className="text-xs text-muted-foreground">
            {r.respondent_name && r.respondent_email ? `${r.respondent_email} · ` : ""}
            {fmtDate(r.submitted_at)}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onDelete} aria-label="Delete response">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <dl className="space-y-2.5">
        {survey.questions.map((q) => {
          const v = r.answers?.[q.id];
          const shown =
            v === null || v === undefined || v === ""
              ? "—"
              : Array.isArray(v)
                ? v.join(", ")
                : q.type === "yes_no"
                  ? v === "yes" ? "Yes" : "No"
                  : String(v);
          return (
            <div key={q.id}>
              <dt className="text-xs text-muted-foreground">{q.label}</dt>
              <dd className={cn("text-sm whitespace-pre-line", shown === "—" && "text-muted-foreground")}>{shown}</dd>
            </div>
          );
        })}
      </dl>
    </Card>
  );
}

function SendDialog(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  surveyId: string;
  origin: string;
  defaultTo: string;
  defaultName: string;
}) {
  const { open, onOpenChange } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send survey by email</DialogTitle>
          <DialogDescription>Sends from your Gmail with the public link. Activates the survey if it is a draft.</DialogDescription>
        </DialogHeader>
        {open && <SendForm {...props} />}
      </DialogContent>
    </Dialog>
  );
}

/** Mounted only while the dialog is open, so every open starts from the defaults. */
function SendForm({
  onOpenChange,
  surveyId,
  origin,
  defaultTo,
  defaultName,
}: {
  onOpenChange: (v: boolean) => void;
  surveyId: string;
  origin: string;
  defaultTo: string;
  defaultName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [to, setTo] = useState(defaultTo);
  const [name, setName] = useState(defaultName);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  function send() {
    setError(null);
    startTransition(async () => {
      const res = await sendSurveyEmail(surveyId, { to, name, message, origin });
      if (res.error) return setError(res.error);
      setSent(true);
      router.refresh();
      setTimeout(() => onOpenChange(false), 900);
    });
  }

  return (
    <>
      <div className="space-y-3">
        <div>
          <Label htmlFor="send-to">To</Label>
          <Input id="send-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="client@example.com" className="mt-1" />
        </div>
        <div>
          <Label htmlFor="send-name">Their name</Label>
          <Input id="send-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Used for the greeting" className="mt-1" />
        </div>
        <div>
          <Label htmlFor="send-msg">Message (optional)</Label>
          <Textarea
            id="send-msg"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="We'd love your feedback. Could you take a couple of minutes to fill out this short survey?"
            className="mt-1 min-h-[80px]"
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {sent && <p className="text-sm text-emerald-500">Sent.</p>}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={send} disabled={pending || !to}>
          {pending ? "Sending..." : "Send"}
        </Button>
      </DialogFooter>
    </>
  );
}
