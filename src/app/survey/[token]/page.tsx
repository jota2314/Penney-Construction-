"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  scaleRange,
  validateAnswers,
  type AnswerValue,
  type SurveyAnswers,
  type SurveyQuestion,
} from "@/lib/surveys/types";

interface PublicSurvey {
  title: string;
  description: string | null;
  status: "draft" | "active" | "closed";
  questions: SurveyQuestion[];
  thank_you_message: string | null;
  collect_contact: boolean;
}

const AMBER = "#D97706";

export default function PublicSurveyPage() {
  const { token } = useParams<{ token: string }>();
  const [survey, setSurvey] = useState<PublicSurvey | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<SurveyAnswers>({});
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/survey/${token}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setSurvey(data);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load");
        setLoading(false);
      });
  }, [token]);

  function setAnswer(id: string, value: AnswerValue) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
    if (fieldErrors[id]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!survey) return;
    const check = validateAnswers(survey.questions, answers);
    if (!check.ok) {
      setFieldErrors(check.errors);
      const firstId = Object.keys(check.errors)[0];
      document.getElementById(`q-${firstId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/survey/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: check.answers, name, email }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.errors) setFieldErrors(data.errors);
        setError(data.error || "Something went wrong");
      } else {
        setDone(data.thank_you_message || "Thank you for your feedback!");
        window.scrollTo({ top: 0 });
      }
    } catch {
      setError("Network error. Please try again.");
    }
    setSubmitting(false);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <p className="text-gray-400 text-sm">Loading...</p>
      </div>
    );
  }

  if (!survey) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center p-8">
          <p className="text-red-600 font-medium">{error || "Survey not found"}</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center py-16">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-5">
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-3">Response received</h1>
          <p className="text-gray-600 px-4 whitespace-pre-line">{done}</p>
        </div>
      </div>
    );
  }

  if (survey.status !== "active") {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center py-16">
          <h1 className="text-xl font-bold text-gray-900 mb-2">{survey.title}</h1>
          <p className="text-gray-500">This survey is not accepting responses right now.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-6 px-4">
      <form onSubmit={handleSubmit} className="max-w-xl mx-auto" noValidate>
        <div className="bg-[#1a1a1a] rounded-t-lg px-6 py-5 text-center">
          <p className="text-xs text-gray-400 tracking-widest uppercase mb-1">Penney Construction Inc.</p>
          <h1 className="text-xl font-bold text-white">{survey.title}</h1>
        </div>

        <div className="bg-white rounded-b-lg shadow-sm border border-gray-200">
          {survey.description && (
            <p className="px-6 py-4 text-sm text-gray-600 border-b border-gray-100 whitespace-pre-line">
              {survey.description}
            </p>
          )}

          {survey.collect_contact && (
            <div className="px-6 py-4 border-b border-gray-100 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-medium text-gray-500">Your name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  placeholder="Optional"
                  autoComplete="name"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-gray-500">Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  placeholder="Optional"
                  autoComplete="email"
                />
              </label>
            </div>
          )}

          <div className="divide-y divide-gray-100">
            {survey.questions.map((q, i) => (
              <div key={q.id} id={`q-${q.id}`} className="px-6 py-5">
                <p className="text-sm font-medium text-gray-900">
                  <span className="text-gray-400 mr-2">{i + 1}.</span>
                  {q.label}
                  {q.required && <span className="text-red-500 ml-1">*</span>}
                </p>
                {q.help_text && <p className="text-xs text-gray-500 mt-1">{q.help_text}</p>}
                <div className="mt-3">
                  <QuestionInput q={q} value={answers[q.id] ?? null} onChange={(v) => setAnswer(q.id, v)} />
                </div>
                {fieldErrors[q.id] && (
                  <p className="text-xs text-red-600 mt-2">{fieldErrors[q.id]}</p>
                )}
              </div>
            ))}
          </div>

          <div className="px-6 py-5 border-t border-gray-100">
            {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md py-3 text-sm font-semibold text-white disabled:opacity-60"
              style={{ backgroundColor: AMBER }}
            >
              {submitting ? "Sending..." : "Submit"}
            </button>
            <p className="text-[11px] text-gray-400 text-center mt-3">
              Penney Construction, Inc. · Your answers are shared only with our team.
            </p>
          </div>
        </div>
      </form>
    </div>
  );
}

function QuestionInput({
  q,
  value,
  onChange,
}: {
  q: SurveyQuestion;
  value: AnswerValue;
  onChange: (v: AnswerValue) => void;
}) {
  const inputCls =
    "w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-500";

  switch (q.type) {
    case "short_text":
      return (
        <input
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
          maxLength={500}
        />
      );
    case "long_text":
      return (
        <textarea
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputCls} min-h-[96px]`}
          maxLength={5000}
        />
      );
    case "single_choice":
      return (
        <div className="space-y-2">
          {q.options?.map((opt) => (
            <ChoiceRow key={opt} label={opt} checked={value === opt} onClick={() => onChange(opt)} kind="radio" />
          ))}
        </div>
      );
    case "multiple_choice": {
      const picked = Array.isArray(value) ? value : [];
      return (
        <div className="space-y-2">
          {q.options?.map((opt) => {
            const on = picked.includes(opt);
            return (
              <ChoiceRow
                key={opt}
                label={opt}
                checked={on}
                kind="checkbox"
                onClick={() => onChange(on ? picked.filter((p) => p !== opt) : [...picked, opt])}
              />
            );
          })}
        </div>
      );
    }
    case "yes_no":
      return (
        <div className="flex gap-2">
          {(["yes", "no"] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => onChange(opt)}
              className={`flex-1 rounded-md border py-2.5 text-sm font-medium capitalize ${
                value === opt
                  ? "border-amber-600 bg-amber-50 text-amber-800"
                  : "border-gray-300 text-gray-700 hover:bg-gray-50"
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      );
    case "rating":
    case "nps": {
      const [min, max] = scaleRange(q.type);
      const nums: number[] = [];
      for (let n = min; n <= max; n++) nums.push(n);
      return (
        <div>
          <div className="flex flex-wrap gap-1.5">
            {nums.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onChange(n)}
                aria-pressed={value === n}
                className={`h-10 min-w-10 flex-1 rounded-md border text-sm font-semibold ${
                  value === n
                    ? "border-amber-600 bg-amber-600 text-white"
                    : "border-gray-300 text-gray-700 hover:bg-gray-50"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="flex justify-between text-[11px] text-gray-400 mt-1.5">
            <span>{q.type === "nps" ? "Not likely" : "Poor"}</span>
            <span>{q.type === "nps" ? "Very likely" : "Excellent"}</span>
          </div>
        </div>
      );
    }
  }
}

function ChoiceRow({
  label,
  checked,
  onClick,
  kind,
}: {
  label: string;
  checked: boolean;
  onClick: () => void;
  kind: "radio" | "checkbox";
}) {
  return (
    <button
      type="button"
      role={kind}
      aria-checked={checked}
      onClick={onClick}
      className={`w-full flex items-center gap-3 rounded-md border px-3 py-2.5 text-left text-sm ${
        checked ? "border-amber-600 bg-amber-50 text-amber-900" : "border-gray-300 text-gray-700 hover:bg-gray-50"
      }`}
    >
      <span
        className={`inline-flex h-4 w-4 shrink-0 items-center justify-center border ${
          kind === "radio" ? "rounded-full" : "rounded"
        } ${checked ? "border-amber-600 bg-amber-600" : "border-gray-400 bg-white"}`}
      >
        {checked && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
      </span>
      {label}
    </button>
  );
}
