"use client";
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getInvoiceReceiptOptions, markClientInvoicePaid } from '@/lib/actions/invoices';

export function ApplyReceiptButton({invoiceId,projectId}:{invoiceId:string;projectId:string}) {
  const router=useRouter();
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState('');
  const [receipts,setReceipts]=useState<Array<{id:string;amount:number;received_date:string;description:string|null;reference_number:string|null}>>([]);
  const [balance,setBalance]=useState(0);
  async function show() {
    setBusy(true);setError('');setSelected('');
    try {
      const result=await getInvoiceReceiptOptions(invoiceId,projectId);
      if(result.error){setError(result.error);return;}
      setReceipts(result.receipts ?? []);setBalance(result.balance ?? 0);setOpen(true);
    } catch { setError('Receipts could not load. Please retry.'); } finally {setBusy(false);}
  }
  async function apply() {
    setBusy(true);setError('');
    try {
      const result=await markClientInvoicePaid(invoiceId,projectId,selected);
      if(result.error){setError(result.error);return;}
      setOpen(false);router.refresh();
    } catch {setError('Payment could not be applied. Refresh before retrying.');} finally {setBusy(false);}
  }
  return <div>
    <button onClick={show} disabled={busy} className="rounded-lg border border-emerald-500/30 px-3 py-2 text-xs text-emerald-400">{busy?'Loading…':'Apply receipt'}</button>
    {!open && error && <p role="alert" className="text-xs text-red-400">{error}</p>}
    {open && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"><section role="dialog" aria-modal="true" aria-label="Apply customer receipt" className="w-full max-w-lg rounded-xl border bg-background p-5 space-y-4">
      <h3 className="font-semibold">Apply customer receipt</h3>
      <p className="text-sm">Unapplied invoice balance: ${balance.toFixed(2)}. Select the receipt that paid this invoice. Equal amounts alone do not identify a payment.</p>
      <label className="block text-sm">Recorded receipt<select value={selected} onChange={e=>setSelected(e.target.value)} className="mt-2 w-full rounded border bg-background p-2"><option value="">Choose a receipt</option>{receipts.map(r=><option key={r.id} value={r.id}>{r.received_date} · ${Number(r.amount).toFixed(2)} · {r.reference_number ? `Ref ${r.reference_number} · `:''}{r.description || 'Receipt'}</option>)}</select></label>
      <p className="text-xs text-muted-foreground">If the payment has not been recorded, record it in <a href="/payments" className="underline">Money in</a> first. This action applies existing money; it does not create another deposit.</p>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      <div className="flex justify-end gap-3"><button disabled={busy} onClick={()=>setOpen(false)}>Cancel</button><button disabled={busy||!selected} onClick={apply} className="rounded border px-3 py-2">{busy?'Applying…':'Apply selected receipt'}</button></div>
    </section></div>}
  </div>;
}
