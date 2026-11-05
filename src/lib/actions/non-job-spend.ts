"use server";

import { revalidatePath } from "next/cache";
import { getUser } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";

export type NonJobReason = "owner_draw" | "card_payment_transfer";
export type NonJobTransaction = {
  id: string;
  vendor_name: string;
  invoice_number: string | null;
  invoice_date: string | null;
  amount: number | null;
  payment_method: string | null;
  source: string | null;
  quickbooks_id: string | null;
  description: string | null;
  created_at: string | null;
  updated_at: string;
  non_job_reason: NonJobReason;
  non_job_resolved_at: string;
  non_job_resolved_by: string;
  non_job_resolved_by_name: string | null;
  non_job_note: string | null;
};
export type NonJobTransactionHistory = {
  id: string;
  action: "resolved" | "reopened";
  reason: NonJobReason | null;
  note: string | null;
  actor_id: string;
  actor_name: string | null;
  created_at: string;
  before_record: Record<string, unknown>;
  after_record: Record<string, unknown>;
};

async function officeClient() {
  const user = await getUser();
  if (!user || !["owner", "office_admin", "precon_manager"].includes(user.profile?.role ?? "")) {
    throw new Error("Office access required");
  }
  return createClient();
}

function refreshSpending(invoiceId: string) {
  revalidatePath(`/spent/${invoiceId}`);
  for (const path of ["/spent/review", "/spent", "/finances", "/finances/daily-log", "/projects", "/money", "/overhead", "/week"]) {
    revalidatePath(path);
  }
}

export async function resolveNonJobTransaction(input: {
  invoiceId: string;
  reason: NonJobReason;
  note?: string;
  expectedUpdatedAt: string;
}): Promise<{ error?: string }> {
  try {
    const supabase = await officeClient();
    if (!["owner_draw", "card_payment_transfer"].includes(input.reason)) return { error: "Choose a non-job reason" };
    if (!input.expectedUpdatedAt) return { error: "Refresh the transaction before resolving it" };
    const { error } = await supabase.rpc("resolve_non_job_transaction", {
      p_invoice_id: input.invoiceId,
      p_reason: input.reason,
      p_note: input.note?.trim() || null,
      p_expected_updated_at: input.expectedUpdatedAt,
    });
    if (error) return { error: error.message };
    // Classification changes only the app's treatment; never push a payment or
    // expense to QuickBooks and never rewrite its existing linked transaction.
    refreshSpending(input.invoiceId);
    return {};
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not resolve transaction" };
  }
}

export async function reopenNonJobTransaction(input: {
  invoiceId: string;
  note: string;
  expectedUpdatedAt: string;
}): Promise<{ error?: string }> {
  try {
    const supabase = await officeClient();
    if (!input.note?.trim()) return { error: "Explain why this transaction is being reopened" };
    if (!input.expectedUpdatedAt) return { error: "Refresh the transaction before reopening it" };
    const { error } = await supabase.rpc("reopen_non_job_transaction", {
      p_invoice_id: input.invoiceId,
      p_note: input.note.trim(),
      p_expected_updated_at: input.expectedUpdatedAt,
    });
    if (error) return { error: error.message };
    refreshSpending(input.invoiceId);
    return {};
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not reopen transaction" };
  }
}

async function actorNames(supabase: Awaited<ReturnType<typeof createClient>>, ids: string[]) {
  const names = new Map<string, string>();
  const unique = [...new Set(ids)];
  for (let start = 0; start < unique.length; start += 100) {
    const { data, error } = await supabase.from("profiles").select("id, full_name").in("id", unique.slice(start, start + 100));
    if (error) throw new Error(error.message);
    for (const row of data ?? []) if (row.full_name) names.set(row.id, row.full_name);
  }
  return names;
}

export async function listNonJobTransactions(): Promise<NonJobTransaction[]> {
  const supabase = await officeClient();
  const rows: Omit<NonJobTransaction, "non_job_resolved_by_name">[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from("invoices")
      .select("id,vendor_name,invoice_number,invoice_date,amount,payment_method,source,quickbooks_id,description,created_at,updated_at,non_job_reason,non_job_resolved_at,non_job_resolved_by,non_job_note")
      .not("non_job_reason", "is", null)
      .order("non_job_resolved_at", { ascending: false }).order("id")
      .range(offset, offset + 499);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []) as Omit<NonJobTransaction, "non_job_resolved_by_name">[]);
    if ((data?.length ?? 0) < 500) break;
  }
  const names = await actorNames(supabase, rows.map(row => row.non_job_resolved_by));
  return rows.map(row => ({ ...row, non_job_resolved_by_name: names.get(row.non_job_resolved_by) ?? null }));
}

export async function getNonJobTransactionHistory(invoiceId: string): Promise<NonJobTransactionHistory[]> {
  const supabase = await officeClient();
  const rows: Omit<NonJobTransactionHistory, "actor_name">[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from("invoice_non_job_history")
      .select("id,action,reason,note,actor_id,created_at,before_record,after_record")
      .eq("invoice_id", invoiceId).order("created_at", { ascending: false }).order("id")
      .range(offset, offset + 499);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []) as Omit<NonJobTransactionHistory, "actor_name">[]);
    if ((data?.length ?? 0) < 500) break;
  }
  const names = await actorNames(supabase, rows.map(row => row.actor_id));
  return rows.map(row => ({ ...row, actor_name: names.get(row.actor_id) ?? null }));
}
