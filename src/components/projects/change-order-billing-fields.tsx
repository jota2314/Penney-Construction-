"use client";

export function ChangeOrderBillingFields({ billingType, terms, onTypeChange, onTermsChange, locked = false }: {
  billingType: "fixed_price" | "time_materials";
  terms: string;
  onTypeChange: (value: "fixed_price" | "time_materials") => void;
  onTermsChange: (value: string) => void;
  locked?: boolean;
}) {
  return <div className="space-y-3">
    <label className="block text-xs font-medium text-muted-foreground">Billing basis
      <select value={billingType} disabled={locked} onChange={e => onTypeChange(e.target.value as "fixed_price" | "time_materials")}
        className="mt-1 w-full rounded-xl border bg-background px-3 py-2 text-sm disabled:opacity-60">
        <option value="fixed_price">Fixed price</option>
        <option value="time_materials">Time & materials</option>
      </select>
    </label>
    {billingType === "time_materials" && <>
      <label className="block text-xs font-medium text-muted-foreground">Client billing rates and terms
        <textarea rows={4} value={terms} disabled={locked} maxLength={6000} onChange={e => onTermsChange(e.target.value)}
          className="mt-1 w-full rounded-xl border bg-background px-3 py-2 text-sm disabled:opacity-60"
          placeholder="Enter the agreed labor billing rates, material pricing and any markup. Leave blank while drafting if not yet confirmed." />
      </label>
      <p className="text-xs text-muted-foreground">Final amount is based on recorded work. Add hours and material quantities in the T&M log; review each charge before publishing it to the client portal.</p>
      {!terms.trim() && <p className="text-xs text-amber-600">Billing terms are pending. This can be saved as a draft but cannot be sent or approved yet.</p>}
    </>}
    {locked && <p className="text-xs text-muted-foreground">The billing basis and terms already shared with the client are locked.</p>}
  </div>;
}
