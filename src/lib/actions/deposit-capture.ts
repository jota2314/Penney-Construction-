"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * The office side of deposit capture — the money-IN mirror of
 * src/lib/actions/field-capture.ts.
 *
 * A flagged payment is already in the books: `review_status` is deliberately
 * separate from anything the finance pages read, so a check the AI half-read
 * still counts toward the job's received total instead of vanishing until
 * someone blesses it. This queue is where it gets corrected, not admitted.
 */

const SIGNED_URL_TTL = 60 * 60;

export type PaymentForReview = {
  id: string;
  payer_name: string | null;
  amount: number | null;
  payment_type: string;
  method: string | null;
  reference_number: string | null;
  received_date: string | null;
  description: string | null;
  review_reason: string | null;
  created_at: string | null;
  project_id: string | null;
  project_label: string;
  photo_url: string | null;
};

export type PaymentJobOption = { id: string; label: string };

type PaymentRow = {
  id: string;
  payer_name: string | null;
  amount: number | null;
  payment_type: string;
  method: string | null;
  reference_number: string | null;
  received_date: string | null;
  description: string | null;
  review_reason: string | null;
  created_at: string | null;
  project_id: string | null;
  photo_storage_path: string | null;
  photo_bucket: string | null;
  projects: { name: string; project_number: string | null } | { name: string; project_number: string | null }[] | null;
};

export async function listPaymentsForReview(): Promise<PaymentForReview[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("payments_received")
    .select(
      "id, payer_name, amount, payment_type, method, reference_number, received_date, description, review_reason, created_at, project_id, photo_storage_path, photo_bucket, projects(name, project_number)",
    )
    .eq("review_status", "needs_review")
    .order("created_at", { ascending: false })
    .limit(100);

  const rows = (data ?? []) as PaymentRow[];

  return Promise.all(
    rows.map(async (row) => {
      const project = Array.isArray(row.projects) ? row.projects[0] : row.projects;

      // Signed per row rather than in one batch: the bucket is private and the
      // list is capped at 100, so the round trips are bounded.
      let photoUrl: string | null = null;
      if (row.photo_storage_path && row.photo_bucket) {
        const { data: signed } = await supabase.storage
          .from(row.photo_bucket)
          .createSignedUrl(row.photo_storage_path, SIGNED_URL_TTL);
        photoUrl = signed?.signedUrl ?? null;
      }

      return {
        id: row.id,
        payer_name: row.payer_name,
        amount: row.amount === null ? null : Number(row.amount),
        payment_type: row.payment_type,
        method: row.method,
        reference_number: row.reference_number,
        received_date: row.received_date,
        description: row.description,
        review_reason: row.review_reason,
        created_at: row.created_at,
        project_id: row.project_id,
        project_label: project
          ? [project.project_number, project.name].filter(Boolean).join(" ")
          : "No job",
        photo_url: photoUrl,
      };
    }),
  );
}

/** Jobs a payment could belong to — wider than the receipt side, because
 *  retainage and final bills land after a job is finished. */
export async function listPaymentJobOptions(): Promise<PaymentJobOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("id, name, project_number")
    .in("status", ["contracted", "in_progress", "completed"])
    .order("name", { ascending: true })
    .limit(200);

  return (data ?? []).map((p) => ({
    id: p.id,
    label: [p.project_number, p.name].filter(Boolean).join(" "),
  }));
}

/**
 * Apply the office's corrections and clear the flag. Everything is optional —
 * the common case is "the numbers are right, just confirm it".
 */
export async function resolvePayment(input: {
  paymentId: string;
  payerName?: string;
  amount?: number;
  paymentType?: string;
  projectId?: string;
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const updates: Record<string, unknown> = {
    review_status: "ok",
    review_reason: null,
  };

  if (input.payerName?.trim()) updates.payer_name = input.payerName.trim();

  if (typeof input.amount === "number" && Number.isFinite(input.amount)) {
    if (input.amount <= 0) return { error: "Amount must be more than zero" };
    updates.amount = input.amount;
  }

  if (input.paymentType) updates.payment_type = input.paymentType;
  if (input.projectId) updates.project_id = input.projectId;

  const { error } = await supabase
    .from("payments_received")
    .update(updates)
    .eq("id", input.paymentId);
  if (error) return { error: error.message };

  revalidatePath("/payments/review");
  revalidatePath("/payments");
  revalidatePath("/command-center");
  return {};
}

/** A duplicate, or a photo of something that was never a payment. */
export async function discardPayment(paymentId: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase.from("payments_received").delete().eq("id", paymentId);
  if (error) return { error: error.message };

  revalidatePath("/payments/review");
  revalidatePath("/payments");
  revalidatePath("/command-center");
  return {};
}
