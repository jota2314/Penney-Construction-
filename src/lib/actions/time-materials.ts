"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";
import { financialRows, loadLaborLedger } from "@/lib/crew/load-labor-ledger";
import type { SaveTimeMaterialEntryInput, TimeMaterialEntry, TimeMaterialSource } from "@/lib/time-materials";

const ENTRY_FIELDS = "id,project_id,change_order_id,work_date,category,description,quantity,unit,unit_rate,amount,source_daily_log_id,source_invoice_id,status,published_at,published_by,void_reason,created_by,created_at,updated_at";
const OFFICE_ROLES = ["owner", "precon_manager", "office_admin", "project_manager"];
const uuid = z.string().uuid();
const entrySchema = z.object({
  id: uuid.optional(), project_id: uuid, change_order_id: uuid,
  work_date: z.iso.date(), category: z.enum(["labor", "material", "equipment", "other"]),
  description: z.string().trim().min(1).max(2000),
  quantity: z.number().finite().positive().max(1000000),
  unit: z.string().trim().min(1).max(30),
  unit_rate: z.number().finite().min(0).max(10000000).nullable(),
  source_daily_log_id: uuid.nullable().optional(), source_invoice_id: uuid.nullable().optional(),
  expected_updated_at: z.string().min(1).optional(),
}).refine(v => !(v.source_daily_log_id && v.source_invoice_id), "Choose one source record.")
  .refine(v => !v.id || !!v.expected_updated_at, "Reload this entry before editing it.");

function entryFromRow(row: Record<string, unknown>): TimeMaterialEntry {
  return { ...row, quantity: Number(row.quantity), unit_rate: row.unit_rate == null ? null : Number(row.unit_rate),
    amount: row.amount == null ? null : Number(row.amount) } as unknown as TimeMaterialEntry;
}

async function access(projectId: string, mutation = false) {
  if (!uuid.safeParse(projectId).success) throw new Error("Invalid project.");
  const user = await getUser();
  if (!user?.profile || !OFFICE_ROLES.includes(user.profile.role)) throw new Error("Only the office and assigned project manager can manage T&M charges.");
  if (mutation && user.isImpersonating) throw new Error("Exit View As before changing client charges.");
  const db = await createClient();
  const { data: project, error } = await db.from("projects").select("id,assigned_pm").eq("id", projectId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!project || (user.profile.role === "project_manager" && project.assigned_pm !== user.profile.id)) throw new Error("You do not have access to this project.");
  return db;
}

function refresh(projectId: string) {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/portal-preview`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The T&M record could not be saved.";
}

/** Staff-only source suggestions. Rates are intentionally never inferred from costs. */
export async function getTimeMaterials(changeOrderId: string, projectId: string): Promise<{
  entries: TimeMaterialEntry[]; sources: TimeMaterialSource[]; error?: string;
}> {
  try {
    if (!uuid.safeParse(changeOrderId).success) throw new Error("Invalid change order.");
    const db = await access(projectId);
    const { data: co, error: coError } = await db.from("change_orders").select("id,billing_type")
      .eq("id", changeOrderId).eq("project_id", projectId).maybeSingle();
    if (coError) throw new Error(coError.message);
    if (!co || co.billing_type !== "time_materials") throw new Error("This is not a T&M change order on this project.");
    const [rows, lines] = await Promise.all([
      financialRows((from, to) => db.from("change_order_tm_entries").select(ENTRY_FIELDS)
        .eq("project_id", projectId).eq("change_order_id", changeOrderId).order("work_date").order("id").range(from, to)),
      financialRows((from, to) => db.from("estimate_line_items").select("id,description")
        .eq("change_order_id", changeOrderId).order("id").range(from, to)),
    ]);
    const entries = rows.map(row => entryFromRow(row as Record<string, unknown>));
    const lineIds = new Set(lines.map(line => line.id));
    const lineNames = new Map(lines.map(line => [line.id, line.description]));
    const usedLogs = new Set(entries.filter(e => e.status !== "void").map(e => e.source_daily_log_id));
    const usedInvoices = new Set(entries.filter(e => e.status !== "void").map(e => e.source_invoice_id));
    const bills = await financialRows((from, to) => db.from("invoices")
      .select("id,invoice_date,vendor_name,description,amount,change_order_id,estimate_line_item_id,review_status")
      .eq("project_id", projectId).is("duplicate_of_id", null).order("id").range(from, to));
    const sources: TimeMaterialSource[] = bills.filter(b => !usedInvoices.has(b.id)
      && (b.change_order_id === changeOrderId || (!b.change_order_id && lineIds.has(b.estimate_line_item_id)))
      && (!b.review_status || b.review_status === "ok") && b.invoice_date).map(b => ({
        source_type: "invoice", id: b.id, work_date: b.invoice_date,
        description: [b.vendor_name, b.description].filter(Boolean).join(" — "),
        quantity: 1, unit: "LS", source_amount: b.amount == null ? null : Number(b.amount),
      }));
    if (lineIds.size) {
      // Allocate daily breaks across ALL jobs before filtering to this CO, exactly
      // as the existing payroll/labor ledger does. Never expose its wage fields.
      const ledger = await loadLaborLedger(db);
      const phaseLines = new Map(ledger.phases.map(p => [p.id, p.estimate_line_item_id]));
      const candidateLogs = ledger.rows.filter(row => row.project_id === projectId && !row.open
        && row.status === "completed" && row.paidMinutes > 0 && !usedLogs.has(row.id)
        && lineIds.has(row.estimate_line_item_id ?? phaseLines.get(row.schedule_phase_id)));
      const reviewedIds = new Set<string>();
      for (let index = 0; index < candidateLogs.length; index += 100) {
        const { data, error } = await db.from("daily_logs").select("id,line_item_needs_review")
          .in("id", candidateLogs.slice(index, index + 100).map(row => row.id));
        if (error) throw new Error(error.message);
        for (const log of data ?? []) if (!log.line_item_needs_review) reviewedIds.add(log.id);
      }
      for (const row of candidateLogs.filter(log => reviewedIds.has(log.id))) {
        sources.push({ source_type: "labor", id: row.id, work_date: row.date,
          description: `${lineNames.get(row.estimate_line_item_id ?? phaseLines.get(row.schedule_phase_id)) || "Labor"} — recorded work`,
          quantity: Math.round(row.paidMinutes / 60 * 10000) / 10000, unit: "hr", source_amount: null });
      }
    }
    return { entries, sources: sources.sort((a, b) => b.work_date.localeCompare(a.work_date) || a.id.localeCompare(b.id)) };
  } catch (error) {
    return { entries: [], sources: [], error: errorMessage(error) };
  }
}

export async function saveTimeMaterialEntry(input: SaveTimeMaterialEntryInput): Promise<{ entry?: TimeMaterialEntry; error?: string }> {
  const parsed = entrySchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the charge details." };
  try {
    const data = parsed.data;
    const db = await access(data.project_id, true);
    const payload = { project_id: data.project_id, change_order_id: data.change_order_id,
      work_date: data.work_date, category: data.category, description: data.description,
      quantity: data.quantity, unit: data.unit, unit_rate: data.unit_rate,
      source_daily_log_id: data.source_daily_log_id ?? null, source_invoice_id: data.source_invoice_id ?? null };
    // Each mutation is one SQL statement; trigger validation and unique source
    // constraints execute atomically. The timestamp predicate prevents lost edits.
    const result = data.id
      ? await db.from("change_order_tm_entries").update(payload).eq("id", data.id)
        .eq("project_id", data.project_id).eq("change_order_id", data.change_order_id)
        .eq("status", "draft").eq("updated_at", data.expected_updated_at!).select(ENTRY_FIELDS).maybeSingle()
      : await db.from("change_order_tm_entries").insert(payload).select(ENTRY_FIELDS).single();
    if (result.error) throw new Error(result.error.code === "23505" ? "This source record already has an active T&M charge." : result.error.message);
    if (!result.data) throw new Error("This entry changed or is no longer a draft. Reload it before saving.");
    refresh(data.project_id);
    return { entry: entryFromRow(result.data as Record<string, unknown>) };
  } catch (error) { return { error: errorMessage(error) }; }
}

export async function publishTimeMaterialEntry(id: string, projectId: string, expectedUpdatedAt: string): Promise<{ entry?: TimeMaterialEntry; error?: string }> {
  try {
    if (!uuid.safeParse(id).success || !expectedUpdatedAt || !Number.isFinite(Date.parse(expectedUpdatedAt))) throw new Error("Reload this entry before publishing.");
    const db = await access(projectId, true);
    const { data, error } = await db.from("change_order_tm_entries").update({ status: "published" })
      .eq("id", id).eq("project_id", projectId).eq("status", "draft").eq("updated_at", expectedUpdatedAt)
      .select(ENTRY_FIELDS).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("This entry changed. Reload and review it before publishing.");
    refresh(projectId);
    return { entry: entryFromRow(data as Record<string, unknown>) };
  } catch (error) { return { error: errorMessage(error) }; }
}

export async function voidTimeMaterialEntry(id: string, projectId: string, reason: string, expectedUpdatedAt: string): Promise<{ entry?: TimeMaterialEntry; error?: string }> {
  try {
    if (!uuid.safeParse(id).success || !expectedUpdatedAt || !Number.isFinite(Date.parse(expectedUpdatedAt))) throw new Error("Reload this entry before voiding.");
    if (typeof reason !== "string" || reason.trim().length < 3 || reason.trim().length > 2000) throw new Error("Enter a reason for voiding this charge (3–2,000 characters).");
    const db = await access(projectId, true);
    const { data, error } = await db.from("change_order_tm_entries").update({ status: "void", void_reason: reason.trim() })
      .eq("id", id).eq("project_id", projectId).neq("status", "void").eq("updated_at", expectedUpdatedAt)
      .select(ENTRY_FIELDS).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("This entry changed. Reload it before voiding.");
    refresh(projectId);
    return { entry: entryFromRow(data as Record<string, unknown>) };
  } catch (error) { return { error: errorMessage(error) }; }
}
