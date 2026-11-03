"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Receipt, Trash2 } from "lucide-react";
import { BottomSheet, BottomSheetBody, BottomSheetContent, BottomSheetDescription, BottomSheetFooter, BottomSheetHeader, BottomSheetTitle } from "@/components/ui/bottom-sheet";
import { createClientInvoice, updateClientInvoice } from "@/lib/actions/invoices";
import { hasQuickBooksCopy, isIssuedInvoice } from "@/lib/finance/client-invoice-revision";
import { formatMoney, parseMoney } from "@/lib/money";

interface InvoiceEditorValue {
  id: string;
  updated_at: string;
  invoice_number: number;
  title: string;
  description?: string | null;
  line_items: { description: string; amount: number; change_order_id?: string }[] | null;
  amount: number;
  terms: string | null;
  status?: string;
  sent_to_client_at?: string | null;
  quickbooks_invoice_id?: string | null;
  quickbooks_id?: string | null;
  quickbooks_doc_number?: string | null;
}
type EditorLine = { description: string; amount: string; change_order_id?: string };
export function ClientInvoiceDialog({ projectId, invoice, projectName, triggerLabel }: { projectId: string; invoice?: InvoiceEditorValue; projectName?: string; triggerLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [editVersion, setEditVersion] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [terms, setTerms] = useState("Due on receipt");
  const [description, setDescription] = useState("");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<EditorLine[]>([
    { description: "", amount: "" },
  ]);
  const router = useRouter();
  // A sent invoice is corrected under its own number; the client already has it.
  const issued = !!invoice && isIssuedInvoice({ status: invoice.status ?? "draft", sent_to_client_at: invoice.sent_to_client_at });
  const quickBooksCopy = !!invoice && hasQuickBooksCopy(invoice);
  // Callers that do not load the description (CEO collections) must not clear it.
  const editsDescription = !invoice || invoice.description !== undefined;

  const total = lines.reduce((s, l) => s + (parseMoney(l.amount) ?? 0), 0);

  function updateLine(idx: number, field: "description" | "amount", value: string) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, { description: "", amount: "" }]);
  }
  function removeLine(idx: number) {
    setLines((prev) => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev);
  }

  async function handleCreate() {
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    const line_items = lines
      .filter((l) => l.description.trim())
      .map((l) => ({
        description: l.description.trim(),
        amount: parseMoney(l.amount) ?? 0,
        ...(l.change_order_id ? { change_order_id: l.change_order_id } : {}),
      }));
    const input = {
      project_id: projectId,
      title: title.trim(),
      description: editsDescription ? description.trim() : undefined,
      line_items,
      terms: terms.trim() || "Due on receipt",
    };
    const res = invoice
      ? await updateClientInvoice(invoice.id, projectId, editVersion, { ...input, reason: reason.trim() })
      : await createClientInvoice(input);
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setOpen(false);
    setTitle("");
    setTerms("Due on receipt");
    setDescription("");
    setReason("");
    setLines([{ description: "", amount: "" }]);
    router.refresh();
  }

  return (
    <>
      <button
        onClick={() => {
          setError(null);
          setEditVersion(invoice?.updated_at ?? "");
          setTitle(invoice?.title ?? "");
          setTerms(invoice?.terms ?? "Due on receipt");
          setDescription(invoice?.description ?? "");
          setReason("");
          setLines(invoice
            ? (invoice.line_items?.length ? invoice.line_items : [{ description: invoice.title, amount: invoice.amount }])
                .map((line): EditorLine => ({
                  description: line.description,
                  amount: String(line.amount),
                  ...("change_order_id" in line && line.change_order_id ? { change_order_id: line.change_order_id } : {}),
                }))
            : [{ description: "", amount: "" }]);
          setOpen(true);
        }}
        className={invoice ? "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs" : "flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-emerald-500/40 text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-500/10 active:scale-[0.99]"}
      >
        {invoice ? <Pencil className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
        {triggerLabel ?? (invoice ? "Edit" : "New Invoice")}
      </button>
      <BottomSheet open={open} onOpenChange={setOpen}>
        <BottomSheetContent>
          <BottomSheetHeader>
            <BottomSheetTitle className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-emerald-400" />
              {invoice ? `Edit Invoice #${invoice.invoice_number}` : "New Client Invoice"}
            </BottomSheetTitle>
            <BottomSheetDescription>
              {projectName ? `${projectName}. ` : ""}
              {issued
                ? `Corrects Invoice #${invoice?.invoice_number} in place: same number, same date. Send the corrected PDF to the client after saving.`
                : "Itemize what the client owes — branded PDF, one-click send."}
            </BottomSheetDescription>
          </BottomSheetHeader>
          <BottomSheetBody className="space-y-3">
            {quickBooksCopy && (
              <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
                QuickBooks is not changed. After saving, the invoice is flagged until the QuickBooks copy
                {invoice?.quickbooks_doc_number ? ` ${invoice.quickbooks_doc_number}` : ""} is updated by hand.
              </p>
            )}
            <div>
              <label className="text-xs font-medium text-muted-foreground">Title *</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Final Invoice — Window Project"
                className="w-full mt-1 px-3 py-2 rounded-xl border bg-background text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Line Items</label>
              <div className="space-y-2 mt-1">
                {lines.map((l, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <input
                      value={l.description}
                      onChange={(e) => updateLine(idx, "description", e.target.value)}
                      placeholder="Description (e.g. Window replacement)"
                      className="flex-1 min-w-0 px-3 py-2 rounded-xl border bg-background text-sm"
                    />
                    <input
                      type="number" step="0.01" inputMode="decimal"
                      value={l.amount}
                      onChange={(e) => updateLine(idx, "amount", e.target.value)}
                      placeholder="$"
                      readOnly={!!l.change_order_id}
                      title={l.change_order_id ? "Applied change order credit. Change it through its change order." : undefined}
                      className="w-24 px-3 py-2 rounded-xl border bg-background text-sm read-only:opacity-60"
                    />
                    <button
                      onClick={() => removeLine(idx)}
                      className="text-muted-foreground hover:text-red-400 p-1 disabled:opacity-30"
                      disabled={lines.length === 1 || !!l.change_order_id}
                      title={l.change_order_id ? "Applied change order credits stay on the invoice" : "Remove line"}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={addLine}
                className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300"
              >
                <Plus className="h-3 w-3" /> Add line
              </button>
            </div>
            <div className="flex items-center justify-between px-1 pt-1 border-t">
              <span className="text-xs font-medium text-muted-foreground">Total</span>
              <span className="text-base font-bold text-emerald-400 tabular-nums">{formatMoney(total)}</span>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Payment Terms</label>
              <input
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
                placeholder="Due on receipt"
                className="w-full mt-1 px-3 py-2 rounded-xl border bg-background text-sm"
              />
            </div>
            {editsDescription && (
              <div>
                <label className="text-xs font-medium text-muted-foreground">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  placeholder="Optional note shown on the invoice PDF"
                  className="w-full mt-1 px-3 py-2 rounded-xl border bg-background text-sm"
                />
              </div>
            )}
            {issued && (
              <div>
                <label className="text-xs font-medium text-muted-foreground">Reason for the correction *</label>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Credit for door items removed from scope per Bill 10/21"
                  className="w-full mt-1 px-3 py-2 rounded-xl border bg-background text-sm"
                />
              </div>
            )}
            {error && <p className="text-xs text-red-400">{error}</p>}
          </BottomSheetBody>
          <BottomSheetFooter>
            <button
              onClick={handleCreate}
              disabled={saving || !title.trim() || (issued && !reason.trim())}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving ? "Saving..." : issued ? "Save Correction" : invoice ? "Save Invoice" : "Create Invoice"}
            </button>
          </BottomSheetFooter>
        </BottomSheetContent>
      </BottomSheet>
    </>
  );
}

