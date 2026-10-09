"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Receipt, Trash2 } from "lucide-react";
import { BottomSheet, BottomSheetBody, BottomSheetContent, BottomSheetDescription, BottomSheetFooter, BottomSheetHeader, BottomSheetTitle } from "@/components/ui/bottom-sheet";
import { createClientInvoice, updateClientInvoice } from "@/lib/actions/invoices";
import { formatMoney, parseMoney } from "@/lib/money";

interface InvoiceEditorValue {
  id: string;
  updated_at: string;
  invoice_number: number;
  title: string;
  line_items: { description: string; amount: number }[] | null;
  amount: number;
  terms: string | null;
}
export function ClientInvoiceDialog({ projectId, invoice, projectName }: { projectId: string; invoice?: InvoiceEditorValue; projectName?: string }) {
  const [open, setOpen] = useState(false);
  const [editVersion, setEditVersion] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [terms, setTerms] = useState("Due on receipt");
  const [lines, setLines] = useState<{ description: string; amount: string }[]>([
    { description: "", amount: "" },
  ]);
  const router = useRouter();

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
      .map((l) => ({ description: l.description.trim(), amount: parseMoney(l.amount) ?? 0 }));
    const input = {
      project_id: projectId,
      title: title.trim(),
      line_items,
      terms: terms.trim() || "Due on receipt",
    };
    const res = invoice
      ? await updateClientInvoice(invoice.id, projectId, editVersion, input)
      : await createClientInvoice(input);
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setOpen(false);
    setTitle("");
    setTerms("Due on receipt");
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
          setLines(invoice
            ? (invoice.line_items?.length ? invoice.line_items : [{ description: invoice.title, amount: invoice.amount }])
                .map((line) => ({ description: line.description, amount: String(line.amount) }))
            : [{ description: "", amount: "" }]);
          setOpen(true);
        }}
        className={invoice ? "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs" : "flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-emerald-500/40 text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-500/10 active:scale-[0.99]"}
      >
        {invoice ? <Pencil className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
        {invoice ? "Edit" : "New Invoice"}
      </button>
      <BottomSheet open={open} onOpenChange={setOpen}>
        <BottomSheetContent>
          <BottomSheetHeader>
            <BottomSheetTitle className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-emerald-400" />
              {invoice ? `Edit Invoice #${invoice.invoice_number}` : "New Client Invoice"}
            </BottomSheetTitle>
            <BottomSheetDescription>
              {projectName ? `${projectName}. ` : ""}Itemize what the client owes — branded PDF, one-click send.
            </BottomSheetDescription>
          </BottomSheetHeader>
          <BottomSheetBody className="space-y-3">
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
                      className="w-24 px-3 py-2 rounded-xl border bg-background text-sm"
                    />
                    <button
                      onClick={() => removeLine(idx)}
                      className="text-muted-foreground hover:text-red-400 p-1 disabled:opacity-30"
                      disabled={lines.length === 1}
                      title="Remove line"
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
            {error && <p className="text-xs text-red-400">{error}</p>}
          </BottomSheetBody>
          <BottomSheetFooter>
            <button
              onClick={handleCreate}
              disabled={saving || !title.trim()}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving ? "Saving..." : invoice ? "Save Invoice" : "Create Invoice"}
            </button>
          </BottomSheetFooter>
        </BottomSheetContent>
      </BottomSheet>
    </>
  );
}

