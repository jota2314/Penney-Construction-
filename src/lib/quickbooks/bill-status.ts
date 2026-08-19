import { createAdminClient } from "@/lib/supabase/admin";
import { getValidAccessToken, isQuickBooksConnected } from "./auth";
import { qbQuery } from "./client";

/**
 * The reverse leg of the bill push: when Nicole pays a Bill INSIDE
 * QuickBooks (Pay bills), the app's row would sit "unpaid" forever. QBO
 * tracks every Bill's open Balance, so we just ask: any app bill whose QBO
 * Balance hit zero flips to paid here too (partial payments become
 * "partial"). Only touches rows the app itself pushed (quickbooks_bill_id
 * set, source != 'quickbooks'), and only the payment fields — never
 * amounts, vendors, or jobs.
 */

type OpenBillRow = {
  id: string;
  amount: number;
  quickbooks_bill_id: string;
  payment_status: string | null;
};

interface QBBillStatus {
  Id: string;
  Balance: number;
  TotalAmt: number;
}

export async function syncBillPaymentStatuses(): Promise<{
  checked: number;
  markedPaid: number;
  markedPartial: number;
  errors: string[];
}> {
  const result = { checked: 0, markedPaid: 0, markedPartial: 0, errors: [] as string[] };
  const supabase = createAdminClient();

  if (!(await isQuickBooksConnected())) {
    result.errors.push("QuickBooks not connected");
    return result;
  }

  const { data, error } = await supabase
    .from("invoices")
    .select("id, amount, quickbooks_bill_id, payment_status")
    .not("quickbooks_bill_id", "is", null)
    .neq("payment_status", "paid")
    .neq("source", "quickbooks")
    .limit(200);
  if (error) {
    result.errors.push(error.message);
    return result;
  }
  const rows = (data ?? []) as OpenBillRow[];
  if (rows.length === 0) return result;

  const { accessToken, realmId, environment } = await getValidAccessToken();

  // One QBO query per chunk of ids, not one per bill.
  const chunks: OpenBillRow[][] = [];
  for (let i = 0; i < rows.length; i += 20) chunks.push(rows.slice(i, i + 20));

  const today = new Date().toISOString().slice(0, 10);

  for (const chunk of chunks) {
    try {
      const ids = chunk.map((r) => `'${r.quickbooks_bill_id}'`).join(",");
      const bills = await qbQuery<QBBillStatus>(
        realmId,
        accessToken,
        `SELECT Id, Balance, TotalAmt FROM Bill WHERE Id IN (${ids})`,
        environment,
      );
      const byId = new Map(bills.map((b) => [String(b.Id), b]));

      for (const row of chunk) {
        result.checked++;
        const bill = byId.get(String(row.quickbooks_bill_id));
        if (!bill) continue;
        const paidAmount = Math.round((bill.TotalAmt - bill.Balance) * 100) / 100;

        if (bill.Balance === 0 && row.payment_status !== "paid") {
          await supabase
            .from("invoices")
            .update({
              payment_status: "paid",
              paid_amount: Number(row.amount) || paidAmount,
              paid_date: today,
            })
            .eq("id", row.id);
          result.markedPaid++;
        } else if (
          bill.Balance > 0 &&
          bill.Balance < bill.TotalAmt &&
          row.payment_status !== "partial"
        ) {
          await supabase
            .from("invoices")
            .update({ payment_status: "partial", paid_amount: paidAmount })
            .eq("id", row.id);
          result.markedPartial++;
        }
      }
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return result;
}
