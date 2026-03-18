"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { QuestionCategory } from "@/types/database";

interface QuestionInput {
  meeting_id: string;
  question: string;
  category: QuestionCategory;
  sort_order: number;
}

export async function getMeetingQuestions(meetingId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("meeting_questions")
    .select("*")
    .eq("meeting_id", meetingId)
    .order("sort_order");
  return data ?? [];
}

export async function bulkCreateMeetingQuestions(
  questions: QuestionInput[]
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("meeting_questions")
    .insert(questions);

  if (error) return { error: error.message };

  if (questions.length > 0) {
    revalidatePath(`/crm/meetings/${questions[0].meeting_id}`);
  }
  return { error: null };
}

export async function answerMeetingQuestion(
  questionId: string,
  answer: string,
  meetingId: string
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("meeting_questions")
    .update({ answer: answer.trim() || null })
    .eq("id", questionId);

  if (error) return { error: error.message };
  revalidatePath(`/crm/meetings/${meetingId}`);
  return { error: null };
}

export async function deleteMeetingQuestions(meetingId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("meeting_questions")
    .delete()
    .eq("meeting_id", meetingId);

  if (error) return { error: error.message };
  revalidatePath(`/crm/meetings/${meetingId}`);
  return { error: null };
}

/** Get Q&A as formatted text for AI estimate prompts */
export async function getMeetingQAForEstimate(meetingId: string) {
  const questions = await getMeetingQuestions(meetingId);
  const answered = questions.filter((q) => q.answer);
  if (answered.length === 0) return null;

  return answered
    .map((q) => `Q: ${q.question}\nA: ${q.answer}`)
    .join("\n\n");
}
