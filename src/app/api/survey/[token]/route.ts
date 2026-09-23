import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeQuestions, validateAnswers } from "@/lib/surveys/types";

export const runtime = "nodejs";

/**
 * Public survey surface — no auth, service role, token is the only key.
 * Mirrors /api/sign-contract. GET returns the form definition, POST stores
 * one response after re-validating every answer server-side.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadSurvey(token: string) {
  if (!UUID_RE.test(token)) return null;
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("surveys")
    .select("id, title, description, status, questions, thank_you_message, collect_contact")
    .eq("public_token", token)
    .maybeSingle();
  return data;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const survey = await loadSurvey(token);
  if (!survey) return NextResponse.json({ error: "Survey not found" }, { status: 404 });

  return NextResponse.json({
    title: survey.title,
    description: survey.description,
    status: survey.status,
    questions: normalizeQuestions(survey.questions),
    thank_you_message: survey.thank_you_message,
    collect_contact: survey.collect_contact,
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const survey = await loadSurvey(token);
  if (!survey) return NextResponse.json({ error: "Survey not found" }, { status: 404 });
  if (survey.status !== "active") {
    return NextResponse.json({ error: "This survey is not accepting responses" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as
    | { answers?: Record<string, unknown>; name?: unknown; email?: unknown }
    | null;
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const questions = normalizeQuestions(survey.questions);
  const result = validateAnswers(questions, body.answers);
  if (!result.ok) {
    return NextResponse.json({ error: "Please answer the required questions", errors: result.errors }, { status: 422 });
  }

  const name = typeof body.name === "string" ? body.name.trim().slice(0, 200) : "";
  const email = typeof body.email === "string" ? body.email.trim().slice(0, 200) : "";
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Please enter a valid email address" }, { status: 422 });
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("survey_responses").insert({
    survey_id: survey.id,
    respondent_name: name || null,
    respondent_email: email || null,
    answers: result.answers,
    user_agent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
  });

  if (error) {
    console.error("[survey-submit]", error.message);
    return NextResponse.json({ error: "Could not save your response. Please try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, thank_you_message: survey.thank_you_message });
}
