"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Copy, GripVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { createSurvey, updateSurvey, type SurveyInput } from "@/lib/actions/surveys";
import {
  CHOICE_TYPES,
  QUESTION_TYPES,
  newQuestionId,
  type QuestionType,
  type Survey,
  type SurveyQuestion,
  type SurveyStatus,
} from "@/lib/surveys/types";
import { SURVEY_TEMPLATES } from "@/lib/surveys/templates";

interface PickerProject {
  id: string;
  name: string;
  project_number: string;
  customer_id: string | null;
}
interface PickerCustomer {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
}

interface SurveyBuilderProps {
  survey?: Survey;
  projects: PickerProject[];
  customers: PickerCustomer[];
}

const NONE = "__none__";

function blankQuestion(type: QuestionType = "short_text"): SurveyQuestion {
  const q: SurveyQuestion = { id: newQuestionId(), type, label: "", required: true };
  if (CHOICE_TYPES.includes(type)) q.options = ["", ""];
  return q;
}

export function SurveyBuilder({ survey, projects, customers }: SurveyBuilderProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isNew = !survey;

  const [title, setTitle] = useState(survey?.title ?? "");
  const [description, setDescription] = useState(survey?.description ?? "");
  const [thankYou, setThankYou] = useState(survey?.thank_you_message ?? "");
  const [collectContact, setCollectContact] = useState(survey?.collect_contact ?? true);
  const [projectId, setProjectId] = useState<string>(survey?.project_id ?? NONE);
  const [customerId, setCustomerId] = useState<string>(survey?.customer_id ?? NONE);
  const [questions, setQuestions] = useState<SurveyQuestion[]>(
    survey?.questions?.length ? survey.questions : [blankQuestion()],
  );
  const [error, setError] = useState<string | null>(null);

  function loadTemplate(key: string) {
    const t = SURVEY_TEMPLATES.find((x) => x.key === key);
    if (!t) return;
    setTitle(t.title);
    setDescription(t.description);
    setThankYou(t.thank_you_message);
    setQuestions(t.questions.map((q) => ({ ...q, id: newQuestionId() })));
  }

  function patchQuestion(id: string, patch: Partial<SurveyQuestion>) {
    setQuestions((qs) => qs.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  }

  function changeType(id: string, type: QuestionType) {
    setQuestions((qs) =>
      qs.map((q) => {
        if (q.id !== id) return q;
        const next: SurveyQuestion = { ...q, type };
        if (CHOICE_TYPES.includes(type)) {
          next.options = q.options?.length ? q.options : ["", ""];
        } else {
          delete next.options;
        }
        return next;
      }),
    );
  }

  function move(id: string, dir: -1 | 1) {
    setQuestions((qs) => {
      const i = qs.findIndex((q) => q.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= qs.length) return qs;
      const next = [...qs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function duplicate(id: string) {
    setQuestions((qs) => {
      const i = qs.findIndex((q) => q.id === id);
      if (i < 0) return qs;
      const copy = { ...qs[i], id: newQuestionId(), options: qs[i].options ? [...qs[i].options] : undefined };
      return [...qs.slice(0, i + 1), copy, ...qs.slice(i + 1)];
    });
  }

  function remove(id: string) {
    setQuestions((qs) => (qs.length > 1 ? qs.filter((q) => q.id !== id) : qs));
  }

  function onPickProject(value: string) {
    setProjectId(value);
    const p = projects.find((x) => x.id === value);
    if (p?.customer_id && customerId === NONE) setCustomerId(p.customer_id);
  }

  function save(status: SurveyStatus) {
    setError(null);
    const input: SurveyInput = {
      title,
      description,
      questions,
      thank_you_message: thankYou,
      collect_contact: collectContact,
      project_id: projectId === NONE ? null : projectId,
      customer_id: customerId === NONE ? null : customerId,
      status,
    };
    startTransition(async () => {
      if (isNew) {
        const res = await createSurvey(input);
        if (res.error) return setError(res.error);
        router.push(`/surveys/${res.id}`);
      } else {
        const res = await updateSurvey(survey.id, input);
        if (res.error) return setError(res.error);
        router.push(`/surveys/${survey.id}`);
      }
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        {isNew && (
          <Card className="p-4">
            <p className="text-sm font-medium mb-2">Start from a template</p>
            <div className="flex flex-wrap gap-2">
              {SURVEY_TEMPLATES.map((t) => (
                <Button key={t.key} type="button" variant="outline" size="sm" onClick={() => loadTemplate(t.key)}>
                  {t.title}
                </Button>
              ))}
            </div>
          </Card>
        )}

        <Card className="p-4 space-y-3">
          <div>
            <Label htmlFor="survey-title">Title</Label>
            <Input
              id="survey-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Post-Project Client Satisfaction"
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="survey-desc">Intro (shown at the top of the form)</Label>
            <Textarea
              id="survey-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Thanks for choosing Penney Construction. This takes about two minutes."
              className="mt-1 min-h-[72px]"
            />
          </div>
        </Card>

        <div className="space-y-3">
          {questions.map((q, i) => (
            <QuestionEditor
              key={q.id}
              index={i}
              q={q}
              total={questions.length}
              onPatch={(patch) => patchQuestion(q.id, patch)}
              onType={(t) => changeType(q.id, t)}
              onMove={(d) => move(q.id, d)}
              onDuplicate={() => duplicate(q.id)}
              onRemove={() => remove(q.id)}
            />
          ))}
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => setQuestions((qs) => [...qs, blankQuestion()])}
          >
            <Plus className="h-4 w-4" /> Add question
          </Button>
        </div>
      </div>

      <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <Card className="p-4 space-y-3">
          <p className="text-sm font-medium">Settings</p>
          <div>
            <Label>Project (optional)</Label>
            <Select value={projectId} onValueChange={onPickProject}>
              <SelectTrigger className="mt-1 w-full">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.project_number} · {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Customer (optional)</Label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger className="mt-1 w-full">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.first_name} {c.last_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={collectContact} onCheckedChange={(v) => setCollectContact(v === true)} />
            Ask for name + email
          </label>
          <div>
            <Label htmlFor="survey-thanks">Thank-you message</Label>
            <Textarea
              id="survey-thanks"
              value={thankYou}
              onChange={(e) => setThankYou(e.target.value)}
              placeholder="Thank you! We appreciate your time."
              className="mt-1 min-h-[64px]"
            />
          </div>
        </Card>

        <Card className="p-4 space-y-2">
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button className="w-full" disabled={pending} onClick={() => save("active")}>
            {pending ? "Saving..." : isNew ? "Save & activate" : "Save & activate"}
          </Button>
          <Button
            className="w-full"
            variant="outline"
            disabled={pending}
            onClick={() => save(survey?.status === "closed" ? "closed" : "draft")}
          >
            {survey?.status === "closed" ? "Save (keep closed)" : "Save as draft"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Active surveys accept responses at their public link. Drafts and closed surveys show a
            &quot;not accepting responses&quot; page.
          </p>
        </Card>
      </div>
    </div>
  );
}

function QuestionEditor({
  index,
  q,
  total,
  onPatch,
  onType,
  onMove,
  onDuplicate,
  onRemove,
}: {
  index: number;
  q: SurveyQuestion;
  total: number;
  onPatch: (patch: Partial<SurveyQuestion>) => void;
  onType: (t: QuestionType) => void;
  onMove: (d: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const isChoice = CHOICE_TYPES.includes(q.type);

  function setOption(i: number, value: string) {
    const opts = [...(q.options ?? [])];
    opts[i] = value;
    onPatch({ options: opts });
  }
  function removeOption(i: number) {
    const opts = (q.options ?? []).filter((_, idx) => idx !== i);
    onPatch({ options: opts.length ? opts : [""] });
  }

  return (
    <Card className="p-4">
      <div className="flex items-start gap-2">
        <GripVertical className="h-4 w-4 mt-2.5 text-muted-foreground shrink-0 hidden sm:block" />
        <div className="flex-1 space-y-3 min-w-0">
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              value={q.label}
              onChange={(e) => onPatch({ label: e.target.value })}
              placeholder={`Question ${index + 1}`}
              className="flex-1"
            />
            <Select value={q.type} onValueChange={(v) => onType(v as QuestionType)}>
              <SelectTrigger className="w-full sm:w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QUESTION_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isChoice && (
            <div className="space-y-1.5">
              {(q.options ?? []).map((opt, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span
                    className={cn(
                      "h-3.5 w-3.5 shrink-0 border border-muted-foreground/50",
                      q.type === "single_choice" ? "rounded-full" : "rounded-sm",
                    )}
                  />
                  <Input
                    value={opt}
                    onChange={(e) => setOption(i, e.target.value)}
                    placeholder={`Option ${i + 1}`}
                    className="h-8"
                  />
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => removeOption(i)} aria-label="Remove option">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onPatch({ options: [...(q.options ?? []), ""] })}
              >
                <Plus className="h-3.5 w-3.5" /> Add option
              </Button>
            </div>
          )}

          <Input
            value={q.help_text ?? ""}
            onChange={(e) => onPatch({ help_text: e.target.value })}
            placeholder="Help text (optional)"
            className="h-8 text-xs"
          />

          <div className="flex items-center justify-between gap-2 flex-wrap">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={q.required} onCheckedChange={(v) => onPatch({ required: v === true })} />
              Required
            </label>
            <div className="flex items-center gap-0.5">
              <Button type="button" variant="ghost" size="icon-sm" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move up">
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" disabled={index === total - 1} onClick={() => onMove(1)} aria-label="Move down">
                <ArrowDown className="h-4 w-4" />
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" onClick={onDuplicate} aria-label="Duplicate">
                <Copy className="h-4 w-4" />
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" disabled={total === 1} onClick={onRemove} aria-label="Delete">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
