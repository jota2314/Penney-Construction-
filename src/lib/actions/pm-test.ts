"use server";

import { revalidatePath } from "next/cache";
import { getUser } from "@/lib/auth/get-user";
import { canEditGuides } from "@/lib/auth/role-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  PM_TEST_ANSWER_MAX_CHARS,
  PM_TEST_KEY,
  PM_TEST_MAX_SCORE,
  PM_TEST_SITUATIONS,
  type PmTestAnswers,
  type PmTestAttempt,
  type PmTestBreakdown,
  type PmTestChangeOrder,
  type PmTestState,
} from "@/lib/training/pm-test";
import {
  gradeWrittenAnswers,
  PmTestGradingError,
  scoreChangeOrders,
  type ChangeOrderRow,
} from "@/lib/training/pm-test-scoring";

const PAGE_PATH = "/guides/pm-test";

const ATTEMPT_COLUMNS =
  "id, profile_id, taker_name, status, score, max_score, answers, breakdown, submitted_at";

const CO_COLUMNS =
  "change_order_number, title, description, status, cost_impact, price_impact, sent_to_client_at, client_signed_at, client_signature";

type Result = { ok: true } | { error: string };

interface AttemptRow {
  id: string;
  profile_id: string;
  taker_name: string | null;
  status: "graded" | "needs_grading";
  score: number | string | null;
  max_score: number | string | null;
  answers: PmTestAnswers | null;
  breakdown: PmTestBreakdown | null;
  submitted_at: string;
}

function toAttempt(row: AttemptRow): PmTestAttempt {
  return {
    id: row.id,
    profileId: row.profile_id,
    takerName: row.taker_name ?? "",
    status: row.status,
    score: row.score == null ? null : Number(row.score),
    maxScore: Number(row.max_score ?? PM_TEST_MAX_SCORE),
    answers: row.answers ?? {},
    breakdown: row.breakdown ?? null,
    submittedAt: row.submitted_at,
  };
}

/**
 * The TEST job assigned to this person. Training jobs are named
 * "TEST — <name> Training: …" and carry the trainee as assigned PM.
 */
async function findTestJob(profileId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("id, project_number, name")
    .eq("assigned_pm", profileId)
    .ilike("name", "TEST%Training%")
    .order("created_at", { ascending: false })
    .limit(1);
  const job = data?.[0];
  return job
    ? { id: job.id as string, projectNumber: (job.project_number as string | null) ?? null, name: job.name as string }
    : null;
}

/** Everything the test page needs, for whoever is looking at it. */
export async function getPmTestState(): Promise<PmTestState | null> {
  const user = await getUser();
  if (!user?.profile) return null;
  const supabase = await createClient();
  const profileId = user.profile.id;
  const isReviewer = canEditGuides(user.profile.email);

  const job = await findTestJob(profileId);
  const [{ data: coRows }, { data: attemptRows }] = await Promise.all([
    job
      ? supabase.from("change_orders").select(CO_COLUMNS).eq("project_id", job.id).order("change_order_number")
      : Promise.resolve({ data: [] as ChangeOrderRow[] }),
    // RLS returns the viewer's own attempt, or every attempt for a reviewer.
    supabase
      .from("training_test_attempts")
      .select(ATTEMPT_COLUMNS)
      .eq("test_key", PM_TEST_KEY)
      .order("submitted_at", { ascending: false }),
  ]);

  const changeOrders: PmTestChangeOrder[] = ((coRows ?? []) as ChangeOrderRow[])
    .filter((r) => r.status !== "void" && r.status !== "rejected")
    .map((r) => ({
      number: r.change_order_number,
      title: r.title ?? "",
      price: Number(r.price_impact ?? 0),
      status: r.status ?? "draft",
      sent: !!r.sent_to_client_at,
      signed: !!(r.client_signed_at || r.client_signature),
    }));

  const attempts = ((attemptRows ?? []) as AttemptRow[]).map(toAttempt);

  return {
    viewerName: user.profile.full_name ?? user.profile.email,
    isReviewer,
    isImpersonating: !!user.isImpersonating,
    job,
    changeOrders,
    attempt: attempts.find((a) => a.profileId === profileId) ?? null,
    allAttempts: isReviewer ? attempts : [],
  };
}

function cleanAnswers(input: unknown): PmTestAnswers {
  const out: PmTestAnswers = {};
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  for (const s of PM_TEST_SITUATIONS) {
    const raw = source[String(s.n)];
    out[String(s.n)] = typeof raw === "string" ? raw.trim().slice(0, PM_TEST_ANSWER_MAX_CHARS) : "";
  }
  return out;
}

/**
 * Grade the written half of a saved attempt and store the final score. The
 * change-order half was frozen when the attempt was submitted, so grading
 * late (or again) never picks up change orders written after the fact.
 */
async function gradeAttempt(attemptId: string, userId?: string): Promise<Result> {
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("training_test_attempts")
    .select(ATTEMPT_COLUMNS)
    .eq("id", attemptId)
    .maybeSingle();
  if (!row) return { error: "That attempt no longer exists." };
  const attempt = toAttempt(row as AttemptRow);
  const handsOn = attempt.breakdown?.handsOn ?? scoreChangeOrders(null);

  let written;
  try {
    written = await gradeWrittenAnswers(attempt.answers, { userId });
  } catch (err) {
    console.error("[pm-test] grading failed", {
      attemptId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      error:
        err instanceof PmTestGradingError
          ? "Your answers are saved, but the score could not be worked out just now. Try again in a minute."
          : "Scoring failed. Your answers are saved.",
    };
  }

  const breakdown: PmTestBreakdown = { handsOn, written };
  const { error } = await admin
    .from("training_test_attempts")
    .update({
      status: "graded",
      score: handsOn.earned + written.earned,
      max_score: PM_TEST_MAX_SCORE,
      breakdown,
      graded_at: new Date().toISOString(),
    })
    .eq("id", attemptId);
  if (error) return { error: "The score could not be saved. Your answers are saved." };
  return { ok: true };
}

/** Submit the test. One attempt per person; the score is worked out here. */
export async function submitPmTest(input: unknown): Promise<Result> {
  const user = await getUser();
  if (!user?.profile) return { error: "Sign in first." };
  if (user.isImpersonating) return { error: "You are viewing as someone else. Exit View-as to submit." };

  const answers = cleanAnswers(input);
  if (!Object.values(answers).some((a) => a.length > 0)) {
    return { error: "Write your answers first." };
  }

  const profileId = user.profile.id;
  const admin = createAdminClient();
  const job = await findTestJob(profileId);

  // Freeze the change orders as they stand right now.
  let coRows: ChangeOrderRow[] | null = null;
  if (job) {
    const { data, error } = await admin.from("change_orders").select(CO_COLUMNS).eq("project_id", job.id);
    if (error) return { error: "Could not read the change orders on your TEST job. Try again." };
    coRows = (data ?? []) as ChangeOrderRow[];
  }
  const breakdown: PmTestBreakdown = { handsOn: scoreChangeOrders(coRows), written: null };

  // Save first, grade second: a slow or failed grader must never lose answers.
  const { data: inserted, error: insertError } = await admin
    .from("training_test_attempts")
    .insert({
      test_key: PM_TEST_KEY,
      profile_id: profileId,
      taker_name: user.profile.full_name ?? user.profile.email,
      project_id: job?.id ?? null,
      answers,
      status: "needs_grading",
      breakdown,
    })
    .select("id")
    .single();
  if (insertError || !inserted) {
    // 23505 = the unique (test_key, profile_id) key: already submitted.
    if (insertError?.code === "23505") {
      revalidatePath(PAGE_PATH);
      return { error: "You already submitted this test." };
    }
    return { error: "Your answers could not be saved. Try again." };
  }

  const graded = await gradeAttempt(inserted.id as string, profileId);
  revalidatePath(PAGE_PATH);
  return graded;
}

/**
 * Finish scoring an attempt whose answers saved but whose score did not. The
 * taker may run it on their own attempt; a reviewer on anyone's.
 */
export async function finishPmTestScoring(attemptId: string): Promise<Result> {
  const user = await getUser();
  if (!user?.profile) return { error: "Sign in first." };
  if (user.isImpersonating) return { error: "Exit View-as first." };

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("training_test_attempts")
    .select("id, profile_id, status")
    .eq("id", attemptId)
    .eq("test_key", PM_TEST_KEY)
    .maybeSingle();
  if (!row) return { error: "That attempt no longer exists." };
  const isOwn = row.profile_id === user.profile.id;
  if (!isOwn && !canEditGuides(user.profile.email)) return { error: "Not yours to score." };
  if (row.status === "graded") {
    revalidatePath(PAGE_PATH);
    return { ok: true };
  }

  const graded = await gradeAttempt(attemptId, user.profile.id);
  revalidatePath(PAGE_PATH);
  return graded;
}

/** Clear an attempt so the person can take the test again. Jorge and Ryan only. */
export async function resetPmTestAttempt(attemptId: string): Promise<Result> {
  const user = await getUser();
  if (!user?.profile) return { error: "Sign in first." };
  if (user.isImpersonating) return { error: "Exit View-as first." };
  if (!canEditGuides(user.profile.email)) return { error: "Only Jorge and Ryan can reset a test." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("training_test_attempts")
    .delete()
    .eq("id", attemptId)
    .eq("test_key", PM_TEST_KEY);
  if (error) return { error: "Could not reset it. Try again." };
  revalidatePath(PAGE_PATH);
  return { ok: true };
}
