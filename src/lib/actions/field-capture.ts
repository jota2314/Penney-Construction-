"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/get-user";
import { notifySpendHelpRequested } from "@/lib/notifications/tagged-mentions";
import { cachedSignedUrls } from "@/lib/storage/signed-url-cache";
import {
  pushVendorExpenseToQuickBooks,
  pushVendorBillToQuickBooks,
} from "@/lib/quickbooks/expenses";

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

/**
 * Rows created from bank statements or the retired Drive ledger represent
 * money that already cleared the bank. They must never be deleted (the month
 * would stop tying to the statement) and never pushed to QuickBooks (QBO sees
 * the same money through its bank feed — pushing would double-book it).
 */
const isBankLedgerRow = (source: string | null): boolean =>
  !!source && (source.startsWith("bank_reconcile") || source.includes("ledger"));

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
  payment_method: string | null;
  source: string | null;
  /** Bank/ledger rows can be reassigned but never discarded or QBO-pushed. */
  is_bank_row: boolean;
  /** Budget lines on this capture's job, for the "put it on this line" picker. */
  budget_lines: CaptureBudgetLine[];
  /** True once someone asked Jorge/Ryan to place this cost and no one has yet. */
  help_pending: boolean;
  /** What the asker said they were stuck on, shown to whoever answers. */
  help_note: string | null;
  who_asked_for_help: string | null;
  /** A receipt image/PDF is on file — the row can show it instead of guessing. */
  has_receipt: boolean;
};

export type CaptureJobOption = {
  id: string;
  label: string;
  /** Overhead / Shop — pinned at the top of pickers as company destinations. */
  internal: boolean;
  /** Picker grouping: company cost centers, active jobs, everything else. */
  bucket: "internal" | "active" | "other";
};

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
    .select("id, description, trade, total_cost, change_order_id, change_orders:change_order_id(change_order_number)")
    .eq("estimate_id", estimateId as string)
    .eq("is_section_header", false)
    .order("description", { ascending: true })
    .limit(300);

  // Change-order lines carry the CO number so the review queue can tell
  // "CO #6 · Plumbing Works" from the base scope; they sort together under "CO".
  return (lines ?? []).map((l) => {
    const co = (Array.isArray(l.change_orders) ? l.change_orders[0] : l.change_orders) as
      | { change_order_number: number | null }
      | null
      | undefined;
    const prefix = l.change_order_id ? (co?.change_order_number ? `CO #${co.change_order_number} · ` : "CO · ") : "";
    return { id: l.id, description: prefix + (l.description ?? ""), trade: l.trade ?? null, total_cost: l.total_cost };
  }) as CaptureBudgetLine[];
}

export async function listCapturesForReview(): Promise<CaptureForReview[]> {
  const supabase = await createClient();

  // Everything that still needs a home: rows the AI flagged for review PLUS
  // rows that carry no project at all (mostly bank-statement lines from the
  // reconcile passes). One queue, so nothing hides below a filter.
  const { data } = await supabase
    .from("invoices")
    .select(
      "id, vendor_name, amount, invoice_number, invoice_date, trade, description, review_reason, created_at, project_id, attachment_storage_path, estimate_line_item_id, payment_method, source, help_requested_at, help_resolved_at, help_note, help_requested_by, projects(name, project_number), estimate_line_items(description)",
    )
    .or("review_status.eq.needs_review,project_id.is.null")
    .order("invoice_date", { ascending: false })
    .limit(500);

  const rows = data ?? [];
  if (rows.length === 0) return [];

  // One signed-URL batch for every photo, then budget lines per distinct job.
  const paths = rows
    .map((r) => r.attachment_storage_path)
    .filter((p): p is string => Boolean(p));
  const signed = paths.length
    ? (await cachedSignedUrls(supabase, "field-captures", paths, SIGNED_URL_TTL)).data
    : null;
  const urlByPath = new Map<string, string>();
  for (const entry of signed ?? []) {
    if (entry.path && entry.signedUrl) urlByPath.set(entry.path, entry.signedUrl);
  }

  // Asker names come from their own query rather than a PostgREST embed:
  // invoices has several FKs to profiles, and a mis-resolved embed makes the
  // WHOLE select fail — which here would render an empty queue rather than an
  // error, i.e. "all my costs disappeared".
  const askerIds = [
    ...new Set(
      rows
        .map((r) => (r.help_requested_at && !r.help_resolved_at ? r.help_requested_by : null))
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const askerNames = new Map<string, string>();
  if (askerIds.length > 0) {
    const { data: askers } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", askerIds);
    for (const a of askers ?? []) if (a.full_name) askerNames.set(a.id, a.full_name);
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
      payment_method: r.payment_method,
      source: r.source,
      is_bank_row: isBankLedgerRow(r.source),
      budget_lines: r.project_id ? linesByProject.get(r.project_id) ?? [] : [],
      help_pending: Boolean(r.help_requested_at) && !r.help_resolved_at,
      help_note: r.help_note ?? null,
      who_asked_for_help: r.help_requested_by ? askerNames.get(r.help_requested_by) ?? null : null,
      has_receipt: Boolean(r.attachment_storage_path),
    };
  });
}

export async function countCapturesForReview(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .or("review_status.eq.needs_review,project_id.is.null");
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

/**
 * EVERY project, no status filter — company cost centers (Overhead
 * PC-2026-179, Shop PC-2026-171) pinned first, then active jobs, then
 * everything else (completed, audit, proposals, leads, cancelled). Sorting
 * Jan–Jul history means costs can belong to any job in any state — a permit
 * paid on a lead that never signed is still that lead's cost.
 */
export async function listCaptureJobOptions(): Promise<CaptureJobOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("id, name, project_number, is_overhead, status")
    .order("name", { ascending: true })
    .limit(500);

  const options: CaptureJobOption[] = (data ?? []).map((p) => {
    const internal =
      Boolean(p.is_overhead) ||
      p.project_number === "PC-2026-171" ||
      p.project_number === "PC-2026-179";
    return {
      id: p.id,
      label: [p.project_number, p.name].filter(Boolean).join(" "),
      internal,
      bucket: internal
        ? ("internal" as const)
        : p.status === "contracted" || p.status === "in_progress"
          ? ("active" as const)
          : ("other" as const),
    };
  });
  const order = { internal: 0, active: 1, other: 2 };
  return options.sort(
    (a, b) => order[a.bucket] - order[b.bucket] || a.label.localeCompare(b.label),
  );
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

  // Confirming IS the answer to an open "which job?" question — clear it here
  // so the asker stops waiting and it drops out of the open-questions count.
  // Whoever confirms first closes it, which is the point of asking two people.
  if (input.lineItemId || input.projectId) {
    updates.help_resolved_at = new Date().toISOString();
    updates.help_resolved_by = user.id;
  }

  if (input.vendorName?.trim()) updates.vendor_name = input.vendorName.trim();

  if (typeof input.amount === "number" && Number.isFinite(input.amount)) {
    // Negative is a credit — a returned pallet, a restocked bundle. Zero is
    // the only amount that can't be a document.
    if (input.amount === 0) return { error: "Amount can't be zero" };
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

  const { data: existing } = await supabase
    .from("invoices")
    .select("source")
    .eq("id", input.invoiceId)
    .single();

  const { error } = await supabase.from("invoices").update(updates).eq("id", input.invoiceId);
  if (error) return { error: error.message };

  // The capture skipped its QBO push while it was flagged; the office just
  // blessed the numbers, so mirror it now. Paid rows become an Expense,
  // unpaid rows a Bill — each helper no-ops on the other kind, and both are
  // idempotent. Best-effort: a QBO failure lands on quickbooks_push_error,
  // never on this confirm. Bank/ledger rows are skipped: QBO already sees
  // that money through its bank feed.
  if (!isBankLedgerRow(existing?.source ?? null)) {
    await pushVendorExpenseToQuickBooks([input.invoiceId]);
    await pushVendorBillToQuickBooks([input.invoiceId]);
  }

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

  const { data: row } = await supabase
    .from("invoices")
    .select("source")
    .eq("id", invoiceId)
    .single();
  if (isBankLedgerRow(row?.source ?? null)) {
    return {
      error:
        "This is a bank-statement line — real money that cleared. Assign it to a job or Overhead instead of deleting it, or the month stops tying to the statement.",
    };
  }

  const { error } = await supabase.from("invoices").delete().eq("id", invoiceId);
  if (error) return { error: error.message };

  revalidatePath("/spent/review");
  revalidatePath("/spent");
  return {};
}

/**
 * Assign a whole batch (typically one vendor's rows) to a job + budget line
 * in one shot. Clears the review flag on every row. QBO mirroring only for
 * rows that came from receipts/emails — bank-statement rows already exist in
 * QBO via its bank feed.
 */
export async function bulkAssignSpend(input: {
  invoiceIds: string[];
  projectId: string;
  lineItemId?: string | null;
}): Promise<{ error?: string; assigned?: number }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const ids = [...new Set(input.invoiceIds)].filter(Boolean);
  if (ids.length === 0) return { error: "Nothing selected" };
  if (!input.projectId) return { error: "Pick a job first" };

  const { error } = await supabase
    .from("invoices")
    .update({
      project_id: input.projectId,
      estimate_line_item_id: input.lineItemId ?? null,
      review_status: "ok",
      review_reason: null,
    })
    .in("id", ids);
  if (error) return { error: error.message };

  const { data: srcRows } = await supabase.from("invoices").select("id, source").in("id", ids);
  for (const row of srcRows ?? []) {
    if (!isBankLedgerRow(row.source)) {
      await pushVendorExpenseToQuickBooks([row.id]);
      await pushVendorBillToQuickBooks([row.id]);
    }
  }

  revalidatePath("/spent/review");
  revalidatePath("/spent");
  revalidatePath("/projects");
  return { assigned: ids.length };
}

/**
 * Split one bill across jobs — e.g. temporary fence where the client pays
 * half via change order and the other half is Shop tools & equipment because
 * Penney keeps the fence. Pieces must add up to the bill exactly; each piece
 * lands on its own job (and optionally a budget line of THAT job). The
 * split_vendor_invoice RPC enforces the balance and the line↔project match.
 */
export async function splitSpend(input: {
  invoiceId: string;
  pieces: {
    projectId: string;
    lineItemId?: string | null;
    amount: number;
    note?: string;
  }[];
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  if (input.pieces.length < 2) return { error: "A split needs at least two pieces" };
  for (const piece of input.pieces) {
    if (!piece.projectId) return { error: "Every piece needs a job" };
    if (!Number.isFinite(piece.amount) || piece.amount === 0) {
      return { error: "Every piece needs a real dollar amount" };
    }
    if (piece.amount < 0 !== input.pieces[0].amount < 0) {
      return { error: "A split can't mix charges and credits — file them separately" };
    }
  }

  const { error } = await supabase.rpc("split_vendor_invoice", {
    p_invoice_id: input.invoiceId,
    p_splits: input.pieces.map((piece) => ({
      project_id: piece.projectId,
      line_item_id: piece.lineItemId ?? null,
      amount: piece.amount,
      note: piece.note ?? "",
    })),
  });
  if (error) return { error: error.message };

  revalidatePath("/spent/review");
  revalidatePath("/spent");
  revalidatePath("/projects");
  return {};
}


/**
 * "I don't know what this is" — hand the row to the people who can say.
 *
 * Budget lines come off the estimates, so the answer lives with whoever wrote
 * them (SPEND_HELP_RESPONDER_EMAILS: Jorge and Ryan). They get an in-app
 * ping, a push and an email that link straight back to this row, and they set
 * the job + budget line themselves — nothing to relay back to the asker.
 *
 * Idempotent: asking twice re-sends nothing, so a double tap can't spam.
 */
export async function requestSpendHelp(input: {
  invoiceId: string;
  note?: string | null;
}): Promise<{ error?: string; alreadyOpen?: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: row } = await supabase
    .from("invoices")
    .select("id, vendor_name, amount, invoice_date, help_requested_at, help_resolved_at")
    .eq("id", input.invoiceId)
    .maybeSingle();
  if (!row) return { error: "That cost is no longer here" };
  if (row.help_requested_at && !row.help_resolved_at) return { alreadyOpen: true };

  const note = input.note?.trim().slice(0, 500) || null;
  const { error } = await supabase
    .from("invoices")
    .update({
      help_requested_at: new Date().toISOString(),
      help_requested_by: user.id,
      help_note: note,
      help_resolved_at: null,
      help_resolved_by: null,
    })
    .eq("id", input.invoiceId);
  if (error) return { error: error.message };

  // Best-effort, exactly like every other notify in the app: a mail or push
  // failure must not make the ask look like it failed. The flag is set; the
  // row shows as waiting either way.
  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .maybeSingle();
    await notifySpendHelpRequested({
      actorId: user.id,
      actorName: profile?.full_name ?? "Someone",
      invoiceId: input.invoiceId,
      vendorName: row.vendor_name,
      amount: row.amount,
      spentOn: row.invoice_date,
      note,
      url: `/spent/review?focus=${input.invoiceId}`,
    });
  } catch (err) {
    console.error("requestSpendHelp notify failed:", err);
  }

  revalidatePath("/spent/review");
  return {};
}

/**
 * Put the actual receipt on a cost that never had one.
 *
 * Most rows in this queue came off a bank statement, so there is no document
 * behind them at all — 159 of the 161 open rows when this was written. The
 * upload itself goes through /api/bills/scan (which stores the file and reads
 * it); this only binds the result to the row that was already in the books,
 * so the money is never double-counted by filing a second invoice.
 */
export async function attachReceiptToCapture(input: {
  invoiceId: string;
  storagePath: string;
  extractedText?: string | null;
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  // The scan route namespaces uploads by `user.profile?.id ?? user.id`, which
  // under View-as impersonation is the IMPERSONATED profile, not the signed-in
  // account. Accept either, or Jorge reviewing as Nicole gets "Not your
  // upload" on a file he just uploaded himself.
  const effective = await getUser();
  const owners = [effective?.profile?.id, effective?.id, user.id].filter(Boolean) as string[];
  if (!owners.some((id) => input.storagePath.startsWith(`${id}/`))) {
    return { error: "Not your upload" };
  }

  const updates: Record<string, unknown> = {
    attachment_storage_path: input.storagePath,
  };
  if (input.extractedText?.trim()) {
    updates.extracted_text = input.extractedText.slice(0, 50000);
  }

  const { error } = await supabase
    .from("invoices")
    .update(updates)
    .eq("id", input.invoiceId);
  if (error) return { error: error.message };

  revalidatePath("/spent/review");
  return {};
}
