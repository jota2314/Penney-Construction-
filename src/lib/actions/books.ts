"use server";

// Books: the chart of accounts, the month close, and the fixes a human makes
// to a line the rules got wrong. Owners and precon only — the same people
// who can see money everywhere else.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/auth/get-user";
import { canSeeBoardMoney } from "@/lib/auth/role-access";
import { backfillBankAccounts, backfillInvoiceAccounts } from "@/lib/finance/account-assign";
import type { AccountType } from "@/lib/finance/accounts";

// Either an error (with any payload fields optional) or the payload.
type Result<T extends object = object> = ({ error: string } & Partial<T>) | ({ error?: undefined } & T);

async function requireBooksUser(): Promise<{ id: string; isOwner: boolean } | { error: string }> {
  const user = await getUser();
  if (!user?.profile) return { error: "Not authenticated" };
  if (!canSeeBoardMoney(user.profile.role)) return { error: "Finance pages are for owners and precon" };
  const realRole = user.realProfile?.role ?? user.profile.role;
  return { id: user.profile.id, isOwner: realRole === "owner" };
}

const BOOKS_PATHS = ["/books", "/spent", "/money", "/week"];
const revalidateBooks = () => BOOKS_PATHS.forEach((p) => revalidatePath(p));

// ---- Chart ---------------------------------------------------------------

export async function updateAccount(input: {
  id: string;
  name?: string;
  qbo_name?: string | null;
  type?: AccountType;
  is_active?: boolean;
  notes?: string | null;
}): Promise<Result> {
  const who = await requireBooksUser();
  if ("error" in who) return who;
  const supabase = await createClient();
  const { data: existing } = await supabase.from("accounts").select("id, is_system, type").eq("id", input.id).maybeSingle();
  if (!existing) return { error: "Account not found" };
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof input.name === "string" && input.name.trim()) updates.name = input.name.trim().slice(0, 80);
  if (input.qbo_name !== undefined) updates.qbo_name = input.qbo_name?.trim() || null;
  if (input.notes !== undefined) updates.notes = input.notes?.trim() || null;
  // System rows keep their type and stay active — the app's own rules point at them.
  if (!existing.is_system) {
    if (input.type) updates.type = input.type;
    if (typeof input.is_active === "boolean") updates.is_active = input.is_active;
  }
  const { error } = await supabase.from("accounts").update(updates).eq("id", input.id);
  if (error) return { error: error.message };
  revalidateBooks();
  return {};
}

export async function createAccount(input: {
  code: string;
  name: string;
  type: AccountType;
  qbo_name?: string | null;
}): Promise<Result<{ id: string }>> {
  const who = await requireBooksUser();
  if ("error" in who) return who;
  const code = input.code.trim();
  if (!/^\d{3,5}$/.test(code)) return { error: "Code is 3–5 digits, e.g. 6975" };
  if (!input.name.trim()) return { error: "Name is required" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accounts")
    .insert({
      code,
      name: input.name.trim().slice(0, 80),
      type: input.type,
      qbo_name: input.qbo_name?.trim() || input.name.trim(),
      sort_order: Number(code),
    })
    .select("id")
    .single();
  if (error) return { error: error.message.includes("duplicate") ? `Code ${code} already exists` : error.message };
  revalidateBooks();
  return { id: data.id };
}

// ---- Fixing a line --------------------------------------------------------

export async function setBankLineAccount(input: { bankTransactionId: string; accountId: string | null }): Promise<Result> {
  const who = await requireBooksUser();
  if ("error" in who) return who;
  const supabase = await createClient();
  const { error } = await supabase
    .from("bank_transactions")
    .update({ account_id: input.accountId })
    .eq("id", input.bankTransactionId);
  if (error) return { error: friendlyLockError(error.message) };
  revalidateBooks();
  return {};
}

export async function setInvoiceAccount(input: { invoiceId: string; accountId: string | null }): Promise<Result> {
  const who = await requireBooksUser();
  if ("error" in who) return who;
  const supabase = await createClient();
  const { error } = await supabase.from("invoices").update({ account_id: input.accountId }).eq("id", input.invoiceId);
  if (error) return { error: friendlyLockError(error.message) };
  revalidateBooks();
  revalidatePath(`/spent/${input.invoiceId}`);
  return {};
}

/** Bulk: every unassigned line for one vendor/description group → one account. */
export async function setBankLinesAccount(input: { bankTransactionIds: string[]; accountId: string }): Promise<Result<{ updated: number }>> {
  const who = await requireBooksUser();
  if ("error" in who) return who;
  if (input.bankTransactionIds.length === 0) return { updated: 0 };
  const supabase = await createClient();
  let updated = 0;
  for (let i = 0; i < input.bankTransactionIds.length; i += 200) {
    const slice = input.bankTransactionIds.slice(i, i + 200);
    const { error } = await supabase.from("bank_transactions").update({ account_id: input.accountId }).in("id", slice);
    if (error) return { error: friendlyLockError(error.message), updated };
    updated += slice.length;
  }
  revalidateBooks();
  return { updated };
}

// ---- Backfill -------------------------------------------------------------

export async function runAccountBackfill(): Promise<Result<{ invoices: { stamped: number; remaining: number }; bank: { stamped: number; remaining: number } }>> {
  const who = await requireBooksUser();
  if ("error" in who) return who;
  const invoices = await backfillInvoiceAccounts(3000);
  const bank = await backfillBankAccounts(3000);
  revalidateBooks();
  return { invoices, bank };
}

// ---- Month close ----------------------------------------------------------

export interface PeriodRow {
  month: string; // YYYY-MM-01
  status: "open" | "locked";
  locked_at: string | null;
  locked_by_name: string | null;
  reopened_at: string | null;
  note: string | null;
}

export async function lockMonth(input: { month: string; note?: string }): Promise<Result> {
  const who = await requireBooksUser();
  if ("error" in who) return who;
  if (!who.isOwner) return { error: "Only an owner can close a month" };
  const month = firstOfMonth(input.month);
  if (!month) return { error: "Bad month" };
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { error } = await admin.from("accounting_periods").upsert(
    { month, status: "locked", locked_at: now, locked_by: who.id, note: input.note?.trim() || null, updated_at: now },
    { onConflict: "month" },
  );
  if (error) return { error: error.message };
  await admin.from("accounting_period_events").insert({ month, action: "lock", actor_id: who.id, note: input.note?.trim() || null });
  revalidateBooks();
  return {};
}

export async function reopenMonth(input: { month: string; note: string }): Promise<Result> {
  const who = await requireBooksUser();
  if ("error" in who) return who;
  if (!who.isOwner) return { error: "Only an owner can reopen a month" };
  const month = firstOfMonth(input.month);
  if (!month) return { error: "Bad month" };
  if (!input.note?.trim()) return { error: "Say why the month is being reopened — it goes in the log" };
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { error } = await admin
    .from("accounting_periods")
    .update({ status: "open", reopened_at: now, reopened_by: who.id, note: input.note.trim(), updated_at: now })
    .eq("month", month);
  if (error) return { error: error.message };
  await admin.from("accounting_period_events").insert({ month, action: "reopen", actor_id: who.id, note: input.note.trim() });
  revalidateBooks();
  return {};
}

// ---- Subs: W-9 -------------------------------------------------------------

export async function updateSubTaxInfo(input: {
  subcontractorId: string;
  w9_on_file?: boolean;
  legal_name?: string | null;
  tax_id_last4?: string | null;
  is_1099_eligible?: boolean;
}): Promise<Result> {
  const who = await requireBooksUser();
  if ("error" in who) return who;
  const supabase = await createClient();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof input.w9_on_file === "boolean") {
    updates.w9_on_file = input.w9_on_file;
    updates.w9_received_at = input.w9_on_file ? new Date().toISOString().slice(0, 10) : null;
  }
  if (input.legal_name !== undefined) updates.legal_name = input.legal_name?.trim() || null;
  if (input.tax_id_last4 !== undefined) {
    const digits = (input.tax_id_last4 ?? "").replace(/\D/g, "").slice(-4);
    updates.tax_id_last4 = digits || null;
  }
  if (typeof input.is_1099_eligible === "boolean") updates.is_1099_eligible = input.is_1099_eligible;
  const { error } = await supabase.from("subcontractors").update(updates).eq("id", input.subcontractorId);
  if (error) return { error: error.message };
  revalidatePath("/books");
  return {};
}

// ---- helpers ----------------------------------------------------------------

function firstOfMonth(s: string): string | null {
  const m = /^(\d{4})-(\d{2})/.exec(s);
  if (!m) return null;
  return `${m[1]}-${m[2]}-01`;
}

/** The trigger's message is already plain English; strip the Postgres prefix if any. */
function friendlyLockError(message: string): string {
  return message.replace(/^.*?(?=[A-Z][a-z]{2} \d{4} is closed)/, "");
}
