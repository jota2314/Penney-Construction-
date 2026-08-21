"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { linePrice } from "@/lib/estimates/line-item-financials";
import { getProjectLaborCost } from "@/lib/actions/labor-cost";

/**
 * Close-out for a single budget line: what we sold it for, what it actually
 * cost, and what we made.
 *
 * Direct margin only (Jorge, 8/21/26) -- client price minus the vendor/sub
 * invoices coded to the line minus the clocked crew labor on it. No overhead
 * allocation, because that share is an assumption and this number needs to be
 * one he can point at an invoice for.
 *
 * Closing snapshots those numbers onto the row and flips is_locked. The lock
 * itself is enforced by DB triggers (migration 00126), not here -- cost
 * reaches a line from far too many call sites for an app-layer check to hold.
 */

export interface LineCloseoutInvoice {
  id: string;
  vendor_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  amount: number;
  payment_status: string | null;
}

export interface LineCloseout {
  lineItemId: string;
  description: string;
  /** What the client is paying for this line. */
  price: number;
  /** Vendor and sub invoices coded to this line. */
  invoiceCost: number;
  /** Clocked crew labor that resolved to this line. */
  laborCost: number;
  totalCost: number;
  /** price - totalCost. Negative means the line lost money. */
  margin: number;
  /** Margin as a percent of price. 0 when the line has no price. */
  marginPct: number;
  /** True once every invoice on the line is marked paid (and there is at least one). */
  fullyPaid: boolean;
  invoices: LineCloseoutInvoice[];
  isLocked: boolean;
  closedAt: string | null;
  closedByName: string | null;
  /** Margin recorded at close. Diverges from `margin` only if cost moved after locking. */
  closedMargin: number | null;
}

/**
 * Close-out figures for every line on an estimate, keyed by line item id.
 */
export async function getLineCloseouts(
  projectId: string,
  estimateId: string,
): Promise<LineCloseout[]> {
  const supabase = await createClient();

  const { data: lines } = await supabase
    .from("estimate_line_items")
    .select(
      "id, description, total_price, client_price, is_section_header, is_locked, closed_at, closed_margin, closed_by, closed_by_profile:profiles!closed_by(full_name)",
    )
    .eq("estimate_id", estimateId)
    .order("sort_order");

  if (!lines || lines.length === 0) return [];

  const lineIds = lines.map((l) => l.id as string);

  const { data: invoices } = await supabase
    .from("invoices")
    .select(
      "id, estimate_line_item_id, vendor_name, invoice_number, invoice_date, amount, payment_status",
    )
    .eq("project_id", projectId)
    .in("estimate_line_item_id", lineIds);

  const invoicesByLine = new Map<string, LineCloseoutInvoice[]>();
  for (const inv of invoices ?? []) {
    const key = inv.estimate_line_item_id as string;
    const list = invoicesByLine.get(key) ?? [];
    list.push({
      id: inv.id as string,
      vendor_name: inv.vendor_name as string | null,
      invoice_number: inv.invoice_number as string | null,
      invoice_date: inv.invoice_date as string | null,
      amount: Number(inv.amount ?? 0),
      payment_status: inv.payment_status as string | null,
    });
    invoicesByLine.set(key, list);
  }

  const labor = await getProjectLaborCost(projectId);
  const laborByLine = new Map<string, number>();
  for (const entry of labor.byLineItem) {
    if (!entry.lineItemId) continue;
    laborByLine.set(
      entry.lineItemId,
      (laborByLine.get(entry.lineItemId) ?? 0) + entry.cents / 100,
    );
  }

  return lines
    // Section headers carry no money of their own; they'd read as 100% margin.
    .filter((l) => !l.is_section_header)
    .map((l) => {
      const id = l.id as string;
      const lineInvoices = invoicesByLine.get(id) ?? [];
      const invoiceCost = lineInvoices.reduce((s, i) => s + i.amount, 0);
      const laborCost = laborByLine.get(id) ?? 0;
      const totalCost = invoiceCost + laborCost;
      const price = linePrice(l);
      const margin = price - totalCost;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const profile: any = Array.isArray((l as any).closed_by_profile)
        ? (l as any).closed_by_profile[0]
        : (l as any).closed_by_profile;

      return {
        lineItemId: id,
        description: (l.description as string) ?? "",
        price,
        invoiceCost,
        laborCost,
        totalCost,
        margin,
        marginPct: price > 0 ? (margin / price) * 100 : 0,
        fullyPaid:
          lineInvoices.length > 0 &&
          lineInvoices.every((i) => i.payment_status === "paid"),
        invoices: lineInvoices,
        isLocked: Boolean(l.is_locked),
        closedAt: (l.closed_at as string | null) ?? null,
        closedByName: profile?.full_name ?? null,
        closedMargin:
          l.closed_margin === null || l.closed_margin === undefined
            ? null
            : Number(l.closed_margin),
      };
    });
}

/**
 * Snapshot the line's realized numbers and lock it. Recomputes server-side
 * rather than trusting figures posted from the client.
 */
export async function closeLineItem(lineItemId: string, projectId: string) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: "Not authenticated" };

  const { data: line } = await supabase
    .from("estimate_line_items")
    .select("id, estimate_id, is_locked")
    .eq("id", lineItemId)
    .single();

  if (!line) return { error: "Budget line not found" };
  if (line.is_locked) return { error: "That line is already closed" };

  const closeouts = await getLineCloseouts(projectId, line.estimate_id as string);
  const c = closeouts.find((x) => x.lineItemId === lineItemId);
  if (!c) return { error: "Could not compute close-out for that line" };

  const { error } = await supabase
    .from("estimate_line_items")
    .update({
      is_locked: true,
      closed_at: new Date().toISOString(),
      closed_by: auth.user.id,
      closed_price: c.price,
      closed_invoice_cost: c.invoiceCost,
      closed_labor_cost: c.laborCost,
      closed_margin: c.margin,
    })
    .eq("id", lineItemId);

  if (error) return { error: error.message };

  revalidatePath(`/projects/${projectId}/budget`);
  revalidatePath(`/projects/${projectId}`);
  return { success: true, margin: c.margin };
}

/**
 * Reopen a closed line so cost can post to it again. The close-out snapshot is
 * cleared -- a reopened line's old margin is not a fact any more, and leaving
 * it would make the next close look like it never moved.
 */
export async function reopenLineItem(lineItemId: string, projectId: string) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("estimate_line_items")
    .update({
      is_locked: false,
      closed_at: null,
      closed_by: null,
      closed_price: null,
      closed_invoice_cost: null,
      closed_labor_cost: null,
      closed_margin: null,
    })
    .eq("id", lineItemId);

  if (error) return { error: error.message };

  revalidatePath(`/projects/${projectId}/budget`);
  revalidatePath(`/projects/${projectId}`);
  return { success: true };
}
