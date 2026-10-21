"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Receipt } from "lucide-react";
import { BottomSheet, BottomSheetBody, BottomSheetContent, BottomSheetDescription, BottomSheetFooter, BottomSheetHeader, BottomSheetTitle } from "@/components/ui/bottom-sheet";
import { applyClientInvoiceCredit, getInvoiceCreditOptions } from "@/lib/actions/client-invoice-credits";
import { type CreditInvoice, type InvoiceCreditOption } from "@/lib/finance/client-invoice-credits";
import { formatMoney, roundCents } from "@/lib/money";

export function ClientInvoiceCreditDialog({ projectId, invoiceId, invoiceNumber }: { projectId: string; invoiceId: string; invoiceNumber: number }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<CreditInvoice | null>(null);
  const [credits, setCredits] = useState<InvoiceCreditOption[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [reason, setReason] = useState("");
  const router = useRouter();
  const selected = credits.find((credit) => credit.id === selectedId);
  const revisedTotal = invoice && selected ? roundCents(Number(invoice.amount) + Number(selected.price_impact)) : null;

  async function openDialog() {
    setOpen(true); setLoading(true); setError(null); setInvoice(null); setCredits([]); setSelectedId(""); setReason("");
    try {
      const result = await getInvoiceCreditOptions(invoiceId, projectId);
      if (result.error) setError(result.error);
      else { setInvoice(result.invoice ?? null); setCredits(result.credits ?? []); }
    } catch { setError("Could not load invoice credits. Please try again."); }
    finally { setLoading(false); }
  }

  async function applyCredit() {
    if (!invoice || !selected || !reason.trim() || revisedTotal === null || revisedTotal <= 0 || saving) return;
    setSaving(true); setError(null);
    try {
      const result = await applyClientInvoiceCredit({ invoiceId, projectId, expectedUpdatedAt: invoice.updated_at,
        changeOrderId: selected.id, expectedChangeOrderUpdatedAt: selected.updated_at, reason: reason.trim() });
      if (result.error) { setError(`${result.error} Close and reopen this form to load current billing before retrying.`); setInvoice(null); setSelectedId(""); return; }
      setOpen(false); router.refresh();
    } catch { setError("Could not confirm the credit. Close and reopen this form to check the current invoice before retrying."); setInvoice(null); setSelectedId(""); }
    finally { setSaving(false); }
  }

  return <>
    <button onClick={openDialog} className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs">
      <Receipt className="h-3.5 w-3.5" /> Apply credit
    </button>
    <BottomSheet open={open} onOpenChange={(value) => { if (!saving) setOpen(value); }}>
      <BottomSheetContent>
        <BottomSheetHeader>
          <BottomSheetTitle>Apply credit to Invoice #{invoiceNumber}</BottomSheetTitle>
          <BottomSheetDescription>Select an approved credit change order. The invoice keeps its number and records the correction in its history.</BottomSheetDescription>
        </BottomSheetHeader>
        <BottomSheetBody className="space-y-4">
          {loading && <p className="text-sm text-muted-foreground">Loading approved credits...</p>}
          {!loading && invoice && credits.length === 0 && <p className="text-sm text-muted-foreground">No unapplied approved credits. Create and approve a negative change order in this project, then reopen this form.</p>}
          {credits.length > 0 && <>
            <div>
              <label htmlFor={`credit-${invoiceId}`} className="text-sm font-medium">Approved credit</label>
              <select id={`credit-${invoiceId}`} value={selectedId} disabled={saving} onChange={(event) => setSelectedId(event.target.value)} className="mt-1 w-full rounded-xl border bg-background p-3 text-sm">
                <option value="">Select a credit</option>
                {credits.map((credit) => <option key={credit.id} value={credit.id}>CO #{credit.change_order_number}: {credit.title} ({formatMoney(Number(credit.price_impact), { cents: "always" })})</option>)}
              </select>
            </div>
            {invoice && selected && <dl className="space-y-2 rounded-xl border p-3 text-sm">
              <div className="flex justify-between"><dt>Current invoice</dt><dd>{formatMoney(Number(invoice.amount), { cents: "always" })}</dd></div>
              <div className="flex justify-between"><dt>Credit</dt><dd>{formatMoney(Number(selected.price_impact), { cents: "always" })}</dd></div>
              <div className="flex justify-between border-t pt-2 font-semibold"><dt>Revised invoice</dt><dd>{formatMoney(revisedTotal, { cents: "always" })}</dd></div>
            </dl>}
            <div>
              <label htmlFor={`credit-reason-${invoiceId}`} className="text-sm font-medium">Reason and approval source</label>
              <textarea id={`credit-reason-${invoiceId}`} value={reason} disabled={saving} maxLength={2000} onChange={(event) => setReason(event.target.value)} placeholder="Why this credit is approved, and where the approval is recorded" className="mt-1 min-h-24 w-full rounded-xl border bg-background p-3 text-sm" />
            </div>
            <p className="text-xs text-muted-foreground">After applying the credit, review the updated PDF and send the revised invoice to the client.</p>
          </>}
          {revisedTotal !== null && revisedTotal <= 0 && <p className="text-sm text-red-400">This credit would leave a zero or negative invoice. Review the credit amount before applying it.</p>}
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        </BottomSheetBody>
        <BottomSheetFooter>
          <button onClick={applyCredit} disabled={loading || saving || !selected || !reason.trim() || revisedTotal === null || revisedTotal <= 0} className="flex h-11 w-full items-center justify-center rounded-xl bg-emerald-600 text-sm font-semibold text-white disabled:opacity-50">
            {saving ? "Applying credit..." : "Apply credit"}
          </button>
        </BottomSheetFooter>
      </BottomSheetContent>
    </BottomSheet>
  </>;
}
