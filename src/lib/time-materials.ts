/** Client charges are independent of payroll wages and vendor costs. */
export type TimeMaterialCategory = "labor" | "material" | "equipment" | "other";
export type TimeMaterialStatus = "draft" | "published" | "void";

export interface TimeMaterialEntry {
  id: string;
  project_id: string;
  change_order_id: string;
  work_date: string;
  category: TimeMaterialCategory;
  description: string;
  quantity: number;
  unit: string;
  unit_rate: number | null;
  amount: number | null;
  source_daily_log_id: string | null;
  source_invoice_id: string | null;
  status: TimeMaterialStatus;
  published_at: string | null;
  published_by: string | null;
  void_reason: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface TimeMaterialSource {
  source_type: "labor" | "invoice";
  id: string;
  work_date: string;
  description: string;
  quantity: number;
  unit: string;
  /** Staff evidence only. Never prefill the client rate from this value. */
  source_amount: number | null;
}

export interface SaveTimeMaterialEntryInput {
  id?: string;
  project_id: string;
  change_order_id: string;
  work_date: string;
  category: TimeMaterialCategory;
  description: string;
  quantity: number;
  unit: string;
  unit_rate: number | null;
  source_daily_log_id?: string | null;
  source_invoice_id?: string | null;
  expected_updated_at?: string;
}

/** Sum stored, PostgreSQL-rounded amounts in cents; null remains unpriced. */
export function timeMaterialTotals(entries: Pick<TimeMaterialEntry, "status" | "amount">[]) {
  return {
    published: entries.filter(e => e.status === "published").reduce((sum, e) => sum + Math.round((e.amount ?? 0) * 100), 0) / 100,
    draft: entries.filter(e => e.status === "draft").reduce((sum, e) => sum + Math.round((e.amount ?? 0) * 100), 0) / 100,
    unpriced: entries.filter(e => e.status === "draft" && e.amount == null).length,
  };
}
