"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * What the Command Center's Receipts and Deposits tiles show when you open
 * them: the actual captures, with the photo and the name of whoever took it.
 *
 * Fetched lazily on tile open rather than pushed through the feed payload —
 * signing a photo URL per row on every Command Center render would be paid by
 * everyone, including the people who never open the tile.
 */

const SIGNED_URL_TTL = 60 * 60;
const CAPTURE_BUCKET = "field-captures";

export type CaptureLineOption = {
  id: string;
  description: string;
  trade: string | null;
};

export type ReceiptCaptureRow = {
  id: string;
  vendor_name: string;
  amount: number | null;
  invoice_date: string | null;
  description: string | null;
  review_status: string;
  review_reason: string | null;
  project_id: string | null;
  project_label: string;
  line_item_id: string | null;
  line_item_label: string | null;
  captured_by: string | null;
  captured_at: string | null;
  photo_url: string | null;
  /** Budget lines on this receipt's job, so the line can be set from the tile. */
  budget_lines: CaptureLineOption[];
};

export type DepositRow = {
  id: string;
  payer_name: string | null;
  amount: number | null;
  payment_type: string;
  method: string | null;
  reference_number: string | null;
  received_date: string | null;
  description: string | null;
  review_status: string;
  review_reason: string | null;
  project_id: string | null;
  project_label: string;
  captured_by: string | null;
  captured_at: string | null;
  photo_url: string | null;
};

type ProjectRef = { name: string; project_number: string | null };
type ProfileRef = { full_name: string | null };

const one = <T,>(value: T | T[] | null): T | null =>
  Array.isArray(value) ? (value[0] ?? null) : value;

const projectLabel = (project: ProjectRef | null): string =>
  project ? [project.project_number, project.name].filter(Boolean).join(" ") : "No job";

/**
 * Budget lines for a job, via the canonical current-estimate pointer.
 * Never hand-roll this lookup: filtering estimates on status in
 * ('approved','draft') silently returns nothing for every SIGNED job, which is
 * what left receipts unassignable for months.
 */
async function budgetLinesFor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
): Promise<CaptureLineOption[]> {
  const { data: estimateId } = await supabase.rpc("current_estimate_id", {
    p_project_id: projectId,
  });
  if (!estimateId) return [];

  const { data } = await supabase
    .from("estimate_line_items")
    .select("id, description, trade")
    .eq("estimate_id", estimateId as string)
    .eq("is_section_header", false)
    .order("description", { ascending: true })
    .limit(300);

  return (data ?? []) as CaptureLineOption[];
}

export async function listRecentReceiptCaptures(limit = 25): Promise<ReceiptCaptureRow[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("invoices")
    .select(
      "id, vendor_name, amount, invoice_date, description, review_status, review_reason, project_id, estimate_line_item_id, attachment_storage_path, created_at, projects(name, project_number), profiles:created_by(full_name), estimate_line_items(description)",
    )
    // Both intake paths land here: crew photos AND office drops (bills/PDFs).
    .in("source", ["field_capture", "office_entry"])
    .order("created_at", { ascending: false })
    .limit(limit);

  const rows = data ?? [];
  if (rows.length === 0) return [];

  // One signed-URL batch for every photo, then budget lines per distinct job.
  const paths = rows
    .map((r) => r.attachment_storage_path)
    .filter((p): p is string => Boolean(p));
  const signed = paths.length
    ? (await supabase.storage.from(CAPTURE_BUCKET).createSignedUrls(paths, SIGNED_URL_TTL)).data
    : null;
  const urlByPath = new Map<string, string>();
  for (const entry of signed ?? []) {
    if (entry.path && entry.signedUrl) urlByPath.set(entry.path, entry.signedUrl);
  }

  const projectIds = [
    ...new Set(rows.map((r) => r.project_id).filter((id): id is string => Boolean(id))),
  ];
  const linesByProject = new Map<string, CaptureLineOption[]>();
  await Promise.all(
    projectIds.map(async (id) => {
      linesByProject.set(id, await budgetLinesFor(supabase, id));
    }),
  );

  return rows.map((row) => {
    const line = one(
      row.estimate_line_items as { description: string } | { description: string }[] | null,
    );
    return {
      id: row.id,
      vendor_name: row.vendor_name,
      amount: row.amount === null ? null : Number(row.amount),
      invoice_date: row.invoice_date,
      description: row.description,
      review_status: row.review_status ?? "ok",
      review_reason: row.review_reason,
      project_id: row.project_id,
      project_label: projectLabel(one(row.projects as ProjectRef | ProjectRef[] | null)),
      line_item_id: row.estimate_line_item_id,
      line_item_label: line?.description ?? null,
      captured_by: one(row.profiles as ProfileRef | ProfileRef[] | null)?.full_name ?? null,
      captured_at: row.created_at,
      photo_url: row.attachment_storage_path
        ? (urlByPath.get(row.attachment_storage_path) ?? null)
        : null,
      budget_lines: row.project_id ? (linesByProject.get(row.project_id) ?? []) : [],
    };
  });
}

export async function listRecentDeposits(limit = 25): Promise<DepositRow[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("payments_received")
    .select(
      "id, payer_name, amount, payment_type, method, reference_number, received_date, description, review_status, review_reason, project_id, photo_storage_path, photo_bucket, created_at, projects(name, project_number), profiles:created_by(full_name)",
    )
    .order("received_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  const rows = data ?? [];
  if (rows.length === 0) return [];

  // Photos only exist on captured deposits; ledger and QuickBooks imports have
  // none, and they're the bulk of the table.
  const paths = rows
    .filter((r) => r.photo_storage_path && r.photo_bucket === CAPTURE_BUCKET)
    .map((r) => r.photo_storage_path as string);
  const signed = paths.length
    ? (await supabase.storage.from(CAPTURE_BUCKET).createSignedUrls(paths, SIGNED_URL_TTL)).data
    : null;
  const urlByPath = new Map<string, string>();
  for (const entry of signed ?? []) {
    if (entry.path && entry.signedUrl) urlByPath.set(entry.path, entry.signedUrl);
  }

  return rows.map((row) => ({
    id: row.id,
    payer_name: row.payer_name,
    amount: row.amount === null ? null : Number(row.amount),
    payment_type: row.payment_type,
    method: row.method,
    reference_number: row.reference_number,
    received_date: row.received_date,
    description: row.description,
    review_status: row.review_status ?? "ok",
    review_reason: row.review_reason,
    project_id: row.project_id,
    project_label: projectLabel(one(row.projects as ProjectRef | ProjectRef[] | null)),
    captured_by: one(row.profiles as ProfileRef | ProfileRef[] | null)?.full_name ?? null,
    captured_at: row.created_at,
    photo_url: row.photo_storage_path
      ? (urlByPath.get(row.photo_storage_path) ?? null)
      : null,
  }));
}

/**
 * Put a receipt on a budget line straight from the tile — the whole point of
 * showing the list. Clearing the flag is conditional: "no budget line matched"
 * is exactly what this fixes, but a receipt flagged because the AI couldn't
 * read the total still needs a human to look at the number, so that one stays
 * in the review queue.
 */
export async function assignCaptureToLine(
  invoiceId: string,
  lineItemId: string | null,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, project_id, review_status, review_reason")
    .eq("id", invoiceId)
    .single();
  if (!invoice) return { error: "Receipt not found" };

  // A line from another job would post this cost onto a budget that doesn't
  // own the receipt — the same guard split_vendor_invoice() enforces in SQL.
  if (lineItemId) {
    const { data: line } = await supabase
      .from("estimate_line_items")
      .select("id, estimates!inner(project_id)")
      .eq("id", lineItemId)
      .maybeSingle();
    const estimate = one(
      line?.estimates as { project_id: string } | { project_id: string }[] | null,
    );
    if (!line || estimate?.project_id !== invoice.project_id) {
      return { error: "That budget line belongs to a different job" };
    }
  }

  const updates: Record<string, unknown> = { estimate_line_item_id: lineItemId };

  const onlyMissingLine =
    invoice.review_status === "needs_review" &&
    invoice.review_reason === "no budget line matched";
  if (lineItemId && onlyMissingLine) {
    updates.review_status = "ok";
    updates.review_reason = null;
  }

  const { error } = await supabase.from("invoices").update(updates).eq("id", invoiceId);
  if (error) return { error: error.message };

  revalidatePath("/command-center");
  revalidatePath("/spent");
  revalidatePath("/spent/review");
  if (invoice.project_id) revalidatePath(`/projects/${invoice.project_id}`);
  return {};
}
