"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * The office side of field invoice capture: everything a crew member's photo
 * produced that the AI wasn't sure about.
 *
 * A flagged capture is already in the books — `review_status` is deliberately
 * separate from `payment_status` so a receipt the AI half-read still counts
 * toward the job's Spent instead of vanishing until someone blesses it. This
 * queue is where it gets corrected, not where it gets admitted.
 */

const SIGNED_URL_TTL = 60 * 60;

export type CaptureBudgetLine = {
  id: string;
  description: string;
  trade: string | null;
  total_cost: number | null;
};

export type CaptureForReview = {
  id: string;
  vendor_name: string;
  amount: number | null;
  invoice_number: string | null;
  invoice_date: string | null;
  trade: string | null;
  description: string | null;
  review_reason: string | null;
  created_at: string | null;
  project_id: string | null;
  project_label: string;
  line_item_id: string | null;
  line_item_label: string | null;
  photo_url: string | null;
  /** Budget lines on this capture's job, for the "put it on this line" picker. */
  budget_lines: CaptureBudgetLine[];
};

export type CaptureJobOption = { id: string; label: string };

/**
 * Budget lines on the job's CURRENT estimate, per the canonical pointer.
 *
 * This used to filter on status in ('approved','draft'), which returned
 * nothing for any signed job — acceptance moves the estimate to 'accepted'.
 * The effect was invisible and nasty: the "put it on a budget line" dropdown
 * in the review queue rendered with no options, so clicking it did nothing at
 * all. Never re-introduce a hand-rolled estimate picker here; see
 * current_estimate_id() (migration 00114).
 */
async function loadBudgetLines(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
): Promise<CaptureBudgetLine[]> {
  const { data: estimateId } = await supabase.rpc("current_estimate_id", {
    p_project_id: projectId,
  });
  if (!estimateId) return [];

  const { data: lines } = await supabase
    .from("estimate_line_items")
    .select("id, description, trade, total_cost")
    .eq("estimate_id", estimateId as string)
    .eq("is_section_header", false)
    .order("description", { ascending: true })
    .limit(300);

  return (lines ?? []) as CaptureBudgetLine[];
}

export async function listCapturesForReview(): Promise<CaptureForReview[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("invoices")
    .select(
      "id, vendor_name, amount, invoice_number, invoice_date, trade, description, review_reason, created_at, project_id, attachment_storage_path, estimate_line_item_id, projects(name, project_number), estimate_line_items(description)",
    )
    .eq("review_status", "needs_review")
    .order("created_at", { ascending: false })
    .limit(100);

  const rows = data ?? [];
  if (rows.length === 0) return [];

  // One signed-URL batch for every photo, then budget lines per distinct job.
  const paths = rows
    .map((r) => r.attachment_storage_path)
    .filter((p): p is string => Boolean(p));
  const signed = paths.length
    ? (await supabase.storage.from("field-captures").createSignedUrls(paths, SIGNED_URL_TTL)).data
    : null;
  const urlByPath = new Map<string, string>();
  for (const entry of signed ?? []) {
    if (entry.path && entry.signedUrl) urlByPath.set(entry.path, entry.signedUrl);
  }

  const projectIds = [...new Set(rows.map((r) => r.project_id).filter((id): id is string => Boolean(id)))];
  const linesByProject = new Map<string, CaptureBudgetLine[]>();
  await Promise.all(
    projectIds.map(async (id) => {
      linesByProject.set(id, await loadBudgetLines(supabase, id));
    }),
  );

  return rows.map((r) => {
    // PostgREST returns an embedded row as an object or a 1-element array
    // depending on the relationship — normalise both shapes.
    const project = (Array.isArray(r.projects) ? r.projects[0] : r.projects) as
      | { name: string; project_number: string | null }
      | null;
    const line = (Array.isArray(r.estimate_line_items)
      ? r.estimate_line_items[0]
      : r.estimate_line_items) as { description: string } | null;

    return {
      id: r.id,
      vendor_name: r.vendor_name,
      amount: r.amount,
      invoice_number: r.invoice_number,
      invoice_date: r.invoice_date,
      trade: r.trade,
      description: r.description,
      review_reason: r.review_reason,
      created_at: r.created_at,
      project_id: r.project_id,
      project_label: project
        ? [project.project_number, project.name].filter(Boolean).join(" ")
        : "No job",
      line_item_id: r.estimate_line_item_id,
      line_item_label: line?.description ?? null,
      photo_url: r.attachment_storage_path
        ? urlByPath.get(r.attachment_storage_path) ?? null
        : null,
      budget_lines: r.project_id ? linesByProject.get(r.project_id) ?? [] : [],
    };
  });
}

export async function countCapturesForReview(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("review_status", "needs_review");
  return count ?? 0;
}

/**
 * Budget lines for ONE job, fetched on demand when the reviewer moves a
 * capture to a different job. Without this the picker had to go dead after a
 * move ("pick after saving"), which meant re-opening the queue to finish a
 * single correction.
 */
export async function listBudgetLinesForJob(
  projectId: string,
): Promise<CaptureBudgetLine[]> {
  if (!projectId) return [];
  const supabase = await createClient();
  return loadBudgetLines(supabase, projectId);
}

/** Active jobs, for moving a capture the AI guessed wrong. */
export async function listCaptureJobOptions(): Promise<CaptureJobOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("id, name, project_number")
    .in("status", ["contracted", "in_progress"])
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
export async function resolveCapture(input: {
  invoiceId: string;
  vendorName?: string;
  amount?: number;
  projectId?: string;
  lineItemId?: string | null;
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

  if (input.vendorName?.trim()) updates.vendor_name = input.vendorName.trim();

  if (typeof input.amount === "number" && Number.isFinite(input.amount)) {
    if (input.amount <= 0) return { error: "Amount must be more than zero" };
    // The crew member paid at the counter, so paid_amount tracks the total —
    // leaving it stale would understate the job's Spent.
    updates.amount = input.amount;
    updates.paid_amount = input.amount;
  }

  if (input.projectId) {
    updates.project_id = input.projectId;
    // A line from the old job would post cost onto a budget that no longer
    // owns this receipt — drop it unless the caller picked a new one.
    updates.estimate_line_item_id = input.lineItemId ?? null;
  } else if (input.lineItemId !== undefined) {
    updates.estimate_line_item_id = input.lineItemId;
  }

  const { error } = await supabase.from("invoices").update(updates).eq("id", input.invoiceId);
  if (error) return { error: error.message };

  revalidatePath("/spent/review");
  revalidatePath("/spent");
  revalidatePath("/projects");
  return {};
}

/** A duplicate or a photo of something that was never a cost. */
export async function discardCapture(invoiceId: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase.from("invoices").delete().eq("id", invoiceId);
  if (error) return { error: error.message };

  revalidatePath("/spent/review");
  revalidatePath("/spent");
  return {};
}
