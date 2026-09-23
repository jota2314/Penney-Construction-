"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/google/gmail";
import {
  normalizeQuestions,
  type Survey,
  type SurveyQuestion,
  type SurveyResponse,
  type SurveyStatus,
} from "@/lib/surveys/types";

const APP_BASE_URL =
  process.env.APP_BASE_URL ?? "https://www.penneyconstruction.build";

export interface SurveyInput {
  title: string;
  description?: string | null;
  questions: SurveyQuestion[];
  thank_you_message?: string | null;
  collect_contact?: boolean;
  project_id?: string | null;
  customer_id?: string | null;
  status?: SurveyStatus;
}

export interface SurveyListRow extends Survey {
  response_count: number;
  project_name: string | null;
  project_number: string | null;
}

function cleanInput(input: SurveyInput) {
  const title = input.title.trim().slice(0, 200);
  if (!title) return { error: "Give the survey a title" as const, row: null };
  const questions = normalizeQuestions(input.questions);
  if (questions.length === 0) {
    return { error: "Add at least one question with a label (choice questions need 2+ options)" as const, row: null };
  }
  return {
    error: null,
    row: {
      title,
      description: input.description?.trim() || null,
      questions,
      thank_you_message: input.thank_you_message?.trim() || null,
      collect_contact: input.collect_contact ?? true,
      project_id: input.project_id || null,
      customer_id: input.customer_id || null,
    },
  };
}

export async function listSurveys(): Promise<SurveyListRow[]> {
  const supabase = await createClient();
  const [{ data: surveys }, { data: counts }] = await Promise.all([
    supabase
      .from("surveys")
      .select("*, projects(name, project_number)")
      .order("updated_at", { ascending: false })
      .limit(500),
    supabase.from("survey_responses").select("survey_id").limit(10000),
  ]);

  const countBy = new Map<string, number>();
  for (const r of counts ?? []) {
    countBy.set(r.survey_id, (countBy.get(r.survey_id) ?? 0) + 1);
  }

  return (surveys ?? []).map((s) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = s.projects as any;
    const project = Array.isArray(p) ? p[0] : p;
    const { projects: _drop, ...rest } = s;
    void _drop;
    return {
      ...(rest as Survey),
      response_count: countBy.get(s.id) ?? 0,
      project_name: project?.name ?? null,
      project_number: project?.project_number ?? null,
    };
  });
}

export async function getSurvey(id: string): Promise<{
  survey: Survey;
  responses: SurveyResponse[];
  project: { id: string; name: string; project_number: string } | null;
  customer: { id: string; first_name: string; last_name: string; email: string | null } | null;
} | null> {
  const supabase = await createClient();
  const { data: survey } = await supabase.from("surveys").select("*").eq("id", id).maybeSingle();
  if (!survey) return null;

  const [{ data: responses }, projectRes, customerRes] = await Promise.all([
    supabase
      .from("survey_responses")
      .select("id, survey_id, respondent_name, respondent_email, answers, submitted_at")
      .eq("survey_id", id)
      .order("submitted_at", { ascending: false })
      .limit(1000),
    survey.project_id
      ? supabase.from("projects").select("id, name, project_number").eq("id", survey.project_id).maybeSingle()
      : Promise.resolve({ data: null }),
    survey.customer_id
      ? supabase.from("customers").select("id, first_name, last_name, email").eq("id", survey.customer_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    survey: { ...survey, questions: normalizeQuestions(survey.questions) } as Survey,
    responses: (responses ?? []) as SurveyResponse[],
    project: projectRes.data ?? null,
    customer: customerRes.data ?? null,
  };
}

export async function createSurvey(input: SurveyInput) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated", id: null };

  const { error: cleanErr, row } = cleanInput(input);
  if (cleanErr) return { error: cleanErr, id: null };

  const { data, error } = await supabase
    .from("surveys")
    .insert({ ...row, status: input.status ?? "draft", created_by: user.id })
    .select("id")
    .single();

  if (error) return { error: error.message, id: null };
  revalidatePath("/surveys");
  return { error: null, id: data.id as string };
}

export async function updateSurvey(id: string, input: SurveyInput) {
  const supabase = await createClient();
  const { error: cleanErr, row } = cleanInput(input);
  if (cleanErr) return { error: cleanErr };

  const patch: Record<string, unknown> = { ...row, updated_at: new Date().toISOString() };
  if (input.status) patch.status = input.status;

  const { error } = await supabase.from("surveys").update(patch).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/surveys");
  revalidatePath(`/surveys/${id}`);
  return { error: null };
}

export async function setSurveyStatus(id: string, status: SurveyStatus) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("surveys")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/surveys");
  revalidatePath(`/surveys/${id}`);
  return { error: null };
}

export async function duplicateSurvey(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated", id: null };

  const { data: src } = await supabase.from("surveys").select("*").eq("id", id).maybeSingle();
  if (!src) return { error: "Survey not found", id: null };

  const { data, error } = await supabase
    .from("surveys")
    .insert({
      title: `${src.title} (copy)`,
      description: src.description,
      questions: src.questions,
      thank_you_message: src.thank_you_message,
      collect_contact: src.collect_contact,
      project_id: src.project_id,
      customer_id: src.customer_id,
      status: "draft",
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error) return { error: error.message, id: null };
  revalidatePath("/surveys");
  return { error: null, id: data.id as string };
}

export async function deleteSurvey(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("surveys").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/surveys");
  return { error: null };
}

export async function deleteSurveyResponse(responseId: string, surveyId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("survey_responses").delete().eq("id", responseId);
  if (error) return { error: error.message };
  revalidatePath(`/surveys/${surveyId}`);
  return { error: null };
}

/** Public link for a survey. Uses the request origin when provided so preview deployments work. */
export async function getSurveyPublicUrl(token: string, origin?: string) {
  return `${origin || APP_BASE_URL}/survey/${token}`;
}

/**
 * Email the survey link through the signed-in user's Gmail. Activates a draft
 * survey first — a link that lands on "not accepting responses" is worse
 * than no email.
 */
export async function sendSurveyEmail(
  id: string,
  input: { to: string; name?: string; message?: string; origin?: string },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const to = input.to.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { error: "Enter a valid email address" };

  const { data: survey } = await supabase.from("surveys").select("*").eq("id", id).maybeSingle();
  if (!survey) return { error: "Survey not found" };
  if (survey.status === "closed") return { error: "This survey is closed. Reopen it before sending." };

  const url = `${input.origin || APP_BASE_URL}/survey/${survey.public_token}`;
  const first = input.name?.trim().split(/\s+/)[0] || "there";
  const intro =
    input.message?.trim() ||
    `We'd love your feedback. Could you take a couple of minutes to fill out this short survey?`;

  const body = `Hi ${first},

${intro}

${survey.title}
${url}

Thank you,
Penney Construction`;

  try {
    await sendEmail({ to, subject: `${survey.title} | Penney Construction`, body });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to send";
    return { error: msg.includes("token") || msg.includes("401") ? "Google account not connected. Sign in with Google in Settings first." : msg };
  }

  await supabase
    .from("surveys")
    .update({
      status: survey.status === "draft" ? "active" : survey.status,
      sent_count: (survey.sent_count ?? 0) + 1,
      last_sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  revalidatePath("/surveys");
  revalidatePath(`/surveys/${id}`);
  return { error: null };
}

/** Lightweight pickers for the builder's project / customer selects. */
export async function getSurveyPickerData() {
  const supabase = await createClient();
  const [{ data: projects }, { data: customers }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, project_number, customer_id")
      .order("created_at", { ascending: false })
      .limit(300),
    supabase
      .from("customers")
      .select("id, first_name, last_name, email")
      .order("last_name")
      .limit(1000),
  ]);
  return {
    projects: (projects ?? []) as { id: string; name: string; project_number: string; customer_id: string | null }[],
    customers: (customers ?? []) as { id: string; first_name: string; last_name: string; email: string | null }[],
  };
}
