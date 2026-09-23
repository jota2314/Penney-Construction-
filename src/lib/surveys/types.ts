/**
 * Survey question + answer shapes shared by the builder, the public form,
 * the submit API and the results view. Kept dependency-free so the public
 * page can import it without pulling in server code.
 */

export const QUESTION_TYPES = [
  { value: "short_text", label: "Short answer" },
  { value: "long_text", label: "Paragraph" },
  { value: "single_choice", label: "Multiple choice (pick one)" },
  { value: "multiple_choice", label: "Checkboxes (pick many)" },
  { value: "rating", label: "Rating 1–5" },
  { value: "nps", label: "Likelihood 0–10" },
  { value: "yes_no", label: "Yes / No" },
] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number]["value"];

export interface SurveyQuestion {
  id: string;
  type: QuestionType;
  label: string;
  required: boolean;
  /** single_choice / multiple_choice only */
  options?: string[];
  help_text?: string;
}

export type SurveyStatus = "draft" | "active" | "closed";

export interface Survey {
  id: string;
  title: string;
  description: string | null;
  status: SurveyStatus;
  public_token: string;
  questions: SurveyQuestion[];
  thank_you_message: string | null;
  collect_contact: boolean;
  project_id: string | null;
  customer_id: string | null;
  created_by: string | null;
  sent_count: number;
  last_sent_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Answer value by question type: text, choice, choices[], or number. */
export type AnswerValue = string | string[] | number | null;
export type SurveyAnswers = Record<string, AnswerValue>;

export interface SurveyResponse {
  id: string;
  survey_id: string;
  respondent_name: string | null;
  respondent_email: string | null;
  answers: SurveyAnswers;
  submitted_at: string;
}

export const CHOICE_TYPES: QuestionType[] = ["single_choice", "multiple_choice"];
export const NUMERIC_TYPES: QuestionType[] = ["rating", "nps"];

export function newQuestionId(): string {
  return `q_${Math.random().toString(36).slice(2, 10)}`;
}

export function scaleRange(type: QuestionType): [number, number] {
  return type === "nps" ? [0, 10] : [1, 5];
}

/** Drop blanks / broken rows so the DB only ever holds renderable questions. */
export function normalizeQuestions(input: unknown): SurveyQuestion[] {
  if (!Array.isArray(input)) return [];
  const validTypes = new Set<string>(QUESTION_TYPES.map((t) => t.value));
  const out: SurveyQuestion[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const q = raw as Partial<SurveyQuestion>;
    const label = typeof q.label === "string" ? q.label.trim() : "";
    if (!label || !q.type || !validTypes.has(q.type)) continue;
    const question: SurveyQuestion = {
      id: typeof q.id === "string" && q.id ? q.id : newQuestionId(),
      type: q.type,
      label: label.slice(0, 500),
      required: !!q.required,
    };
    if (CHOICE_TYPES.includes(q.type)) {
      const options = (Array.isArray(q.options) ? q.options : [])
        .map((o) => (typeof o === "string" ? o.trim() : ""))
        .filter(Boolean)
        .slice(0, 20);
      if (options.length < 2) continue;
      question.options = options;
    }
    if (typeof q.help_text === "string" && q.help_text.trim()) {
      question.help_text = q.help_text.trim().slice(0, 500);
    }
    out.push(question);
  }
  return out.slice(0, 50);
}

export interface ValidationResult {
  ok: boolean;
  /** question id → message */
  errors: Record<string, string>;
  /** cleaned answers safe to store */
  answers: SurveyAnswers;
}

/**
 * Validate + clean a submission against the survey's questions. Used by the
 * public form (inline errors) and by the API (never trust the client).
 */
export function validateAnswers(
  questions: SurveyQuestion[],
  raw: Record<string, unknown> | null | undefined,
): ValidationResult {
  const errors: Record<string, string> = {};
  const answers: SurveyAnswers = {};
  const input = raw ?? {};

  for (const q of questions) {
    const v = input[q.id];
    let clean: AnswerValue = null;

    switch (q.type) {
      case "short_text":
      case "long_text": {
        const s = typeof v === "string" ? v.trim() : "";
        clean = s ? s.slice(0, q.type === "short_text" ? 500 : 5000) : null;
        break;
      }
      case "single_choice": {
        const s = typeof v === "string" ? v : "";
        clean = q.options?.includes(s) ? s : null;
        break;
      }
      case "multiple_choice": {
        const arr = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
        const picked = arr.filter((x) => q.options?.includes(x));
        clean = picked.length ? Array.from(new Set(picked)) : null;
        break;
      }
      case "rating":
      case "nps": {
        const n = typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) : NaN;
        const [min, max] = scaleRange(q.type);
        clean = Number.isInteger(n) && n >= min && n <= max ? n : null;
        break;
      }
      case "yes_no": {
        clean = v === "yes" || v === "no" ? v : null;
        break;
      }
    }

    if (q.required && clean === null) {
      errors[q.id] = "This question is required";
    }
    if (clean !== null) answers[q.id] = clean;
  }

  return { ok: Object.keys(errors).length === 0, errors, answers };
}
