"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Sparkles, Loader2, CheckCircle2, Circle, RotateCcw } from "lucide-react";
import {
  bulkCreateMeetingQuestions,
  answerMeetingQuestion,
  deleteMeetingQuestions,
} from "@/lib/actions/meeting-questions";
import type { MeetingQuestion, MeetingNote, QuestionCategory } from "@/types/database";

const CATEGORY_LABELS: Record<QuestionCategory, string> = {
  dimensions: "Dimensions",
  materials: "Materials",
  fixtures: "Fixtures",
  structural: "Structural",
  scope: "Scope",
  budget: "Budget",
  timeline: "Timeline",
  general: "General",
};

const CATEGORY_COLORS: Record<QuestionCategory, string> = {
  dimensions: "bg-blue-100 text-blue-700",
  materials: "bg-purple-100 text-purple-700",
  fixtures: "bg-amber-100 text-amber-700",
  structural: "bg-red-100 text-red-700",
  scope: "bg-emerald-100 text-emerald-700",
  budget: "bg-green-100 text-green-700",
  timeline: "bg-orange-100 text-orange-700",
  general: "bg-slate-100 text-slate-700",
};

interface MeetingQuestionsPanelProps {
  meetingId: string;
  summary: string | null;
  notes: MeetingNote[];
  questions: MeetingQuestion[];
  projectType?: string | null;
  clientName?: string;
  address?: string | null;
}

export function MeetingQuestionsPanel({
  meetingId,
  summary,
  notes,
  questions: initialQuestions,
  projectType,
  clientName,
  address,
}: MeetingQuestionsPanelProps) {
  const [questions, setQuestions] = useState<MeetingQuestion[]>(initialQuestions);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const hasQuestions = questions.length > 0;
  const answeredCount = questions.filter((q) => q.answer).length;
  const canGenerate = !!summary || notes.length > 0;

  async function handleGenerate() {
    setGenerating(true);
    setError(null);

    try {
      // Build meeting notes text
      const meetingNotes = notes.map((n) => n.content).join("\n\n");

      const res = await fetch("/api/generate-project-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meetingSummary: summary || "",
          meetingNotes,
          projectType,
          clientName,
          address,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Failed to generate questions");
        setGenerating(false);
        return;
      }

      const generated: { question: string; category: string; sort_order: number }[] =
        data.questions ?? [];

      if (generated.length === 0) {
        setError("AI found no missing information — your notes are thorough!");
        setGenerating(false);
        return;
      }

      // Save to DB
      const toInsert = generated.map((q, i) => ({
        meeting_id: meetingId,
        question: q.question,
        category: q.category as QuestionCategory,
        sort_order: i,
      }));

      const { error: saveError } = await bulkCreateMeetingQuestions(toInsert);

      if (saveError) {
        setError(saveError);
        setGenerating(false);
        return;
      }

      // Create local state with temp IDs
      const newQuestions: MeetingQuestion[] = toInsert.map((q, i) => ({
        id: `temp-${i}-${Date.now()}`,
        meeting_id: meetingId,
        question: q.question,
        answer: null,
        category: q.category,
        sort_order: q.sort_order,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

      setQuestions(newQuestions);
    } catch {
      setError("Failed to generate questions. Please try again.");
    }

    setGenerating(false);
  }

  async function handleRegenerate() {
    // Delete existing questions first
    await deleteMeetingQuestions(meetingId);
    setQuestions([]);
    // Then generate new ones
    await handleGenerate();
  }

  async function handleAnswerSave(questionId: string, answer: string) {
    setSavingId(questionId);
    const { error: saveError } = await answerMeetingQuestion(
      questionId,
      answer,
      meetingId
    );

    if (saveError) {
      setError(saveError);
    } else {
      setQuestions((prev) =>
        prev.map((q) =>
          q.id === questionId
            ? { ...q, answer: answer.trim() || null }
            : q
        )
      );
    }
    setSavingId(null);
  }

  if (!canGenerate && !hasQuestions) {
    return (
      <div className="text-center text-sm text-muted-foreground py-8">
        Complete the meeting summary first to generate follow-up questions.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Generate / Regenerate button */}
      {!hasQuestions ? (
        <Button
          type="button"
          size="lg"
          className="w-full h-14 text-base"
          disabled={generating || !canGenerate}
          onClick={handleGenerate}
        >
          {generating ? (
            <>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Analyzing meeting for missing details...
            </>
          ) : (
            <>
              <Sparkles className="mr-2 h-5 w-5" />
              Generate Follow-Up Questions
            </>
          )}
        </Button>
      ) : (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            {answeredCount} of {questions.length} answered
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={generating}
            onClick={handleRegenerate}
          >
            {generating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="mr-2 h-4 w-4" />
            )}
            Regenerate
          </Button>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Questions list */}
      {hasQuestions && (
        <div className="space-y-3">
          {questions.map((q) => (
            <QuestionCard
              key={q.id}
              question={q}
              saving={savingId === q.id}
              onSave={handleAnswerSave}
            />
          ))}
        </div>
      )}

      {hasQuestions && answeredCount > 0 && (
        <p className="text-xs text-muted-foreground text-center">
          Answered questions will automatically feed into AI estimate generation.
        </p>
      )}
    </div>
  );
}

function QuestionCard({
  question,
  saving,
  onSave,
}: {
  question: MeetingQuestion;
  saving: boolean;
  onSave: (id: string, answer: string) => void;
}) {
  const [answer, setAnswer] = useState(question.answer ?? "");
  const hasAnswer = !!question.answer;

  return (
    <Card className={hasAnswer ? "border-green-200 bg-green-50/30" : ""}>
      <CardContent className="py-3 space-y-2">
        <div className="flex items-start gap-2">
          {hasAnswer ? (
            <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
          ) : (
            <Circle className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
          )}
          <div className="flex-1 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium leading-snug">
                {question.question}
              </p>
              <Badge
                variant="secondary"
                className={`text-[10px] flex-shrink-0 ${CATEGORY_COLORS[question.category]}`}
              >
                {CATEGORY_LABELS[question.category]}
              </Badge>
            </div>
            <div className="flex gap-2">
              <Input
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onBlur={() => {
                  if (answer !== (question.answer ?? "")) {
                    onSave(question.id, answer);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.currentTarget.blur();
                  }
                }}
                placeholder="Type your answer..."
                className="text-sm h-9"
                disabled={saving}
              />
              {saving && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mt-2.5" />
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
