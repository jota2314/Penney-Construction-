"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Trash2, Check, CheckCheck, Loader2 } from "lucide-react";
import type { ScanDraft, StagedProject, StagedCustomer, StagedSub, StagedQuote, StagedFollowUp } from "./sync-button";

interface ScanReviewDialogProps {
  draft: ScanDraft;
  onApprove: (draft: ScanDraft) => Promise<void>;
  onCancel: () => void;
}

type Tab = "projects" | "customers" | "subs" | "quotes" | "followUps";

export function ScanReviewDialog({ draft, onApprove, onCancel }: ScanReviewDialogProps) {
  const [activeTab, setActiveTab] = useState<Tab>("projects");
  const [data, setData] = useState<ScanDraft>({ ...draft });
  const [saving, setSaving] = useState(false);

  const tabs: { key: Tab; label: string; count: number; approved: number }[] = [
    { key: "projects", label: "Projects", count: data.projects.length, approved: data.projects.filter((p) => p.approved).length },
    { key: "customers", label: "Customers", count: data.customers.length, approved: data.customers.filter((c) => c.approved).length },
    { key: "subs", label: "Subs", count: data.subs.length, approved: data.subs.filter((s) => s.approved).length },
    { key: "quotes", label: "Quotes", count: data.quotes.length, approved: data.quotes.filter((q) => q.approved).length },
    { key: "followUps", label: "Follow-ups", count: data.followUps.length, approved: data.followUps.filter((f) => f.approved).length },
  ];

  function toggleApproval(type: Tab, id: string) {
    setData((prev) => {
      const updated = { ...prev };
      const list = [...(updated[type] as { id: string; approved: boolean }[])];
      const idx = list.findIndex((item) => item.id === id);
      if (idx >= 0) list[idx] = { ...list[idx], approved: !list[idx].approved };
      (updated[type] as typeof list) = list;
      return updated;
    });
  }

  function removeItem(type: Tab, id: string) {
    setData((prev) => {
      const updated = { ...prev };
      (updated[type] as { id: string }[]) = (updated[type] as { id: string }[]).filter((item) => item.id !== id);
      return updated;
    });
  }

  function updateField<T extends Tab>(type: T, id: string, field: string, value: string) {
    setData((prev) => {
      const updated = { ...prev };
      const list = [...(updated[type] as { id: string }[])];
      const idx = list.findIndex((item) => item.id === id);
      if (idx >= 0) list[idx] = { ...list[idx], [field]: value };
      (updated[type] as typeof list) = list;
      return updated;
    });
  }

  async function handleApprove() {
    setSaving(true);
    await onApprove(data);
    setSaving(false);
  }

  const totalApproved = tabs.reduce((sum, t) => sum + t.approved, 0);
  const totalItems = tabs.reduce((sum, t) => sum + t.count, 0);

  return (
    <Dialog open onOpenChange={() => onCancel()}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Review Scan Results</DialogTitle>
          <DialogDescription>
            {data.emailCount} emails scanned. Review and edit before creating. Uncheck items you don&apos;t want.
          </DialogDescription>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex gap-1 border-b pb-2 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1.5 text-sm rounded-md whitespace-nowrap transition-colors ${
                activeTab === tab.key
                  ? "bg-amber-500/20 text-amber-400"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
              <Badge variant="secondary" className="ml-1.5 text-[10px]">
                {tab.approved}/{tab.count}
              </Badge>
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto min-h-0 space-y-2 py-2">
          {activeTab === "projects" && data.projects.map((p) => (
            <ProjectRow key={p.id} project={p} onToggle={() => toggleApproval("projects", p.id)} onRemove={() => removeItem("projects", p.id)} onUpdate={(f, v) => updateField("projects", p.id, f, v)} />
          ))}
          {activeTab === "customers" && data.customers.map((c) => (
            <CustomerRow key={c.id} customer={c} onToggle={() => toggleApproval("customers", c.id)} onRemove={() => removeItem("customers", c.id)} onUpdate={(f, v) => updateField("customers", c.id, f, v)} />
          ))}
          {activeTab === "subs" && data.subs.map((s) => (
            <SubRow key={s.id} sub={s} onToggle={() => toggleApproval("subs", s.id)} onRemove={() => removeItem("subs", s.id)} onUpdate={(f, v) => updateField("subs", s.id, f, v)} />
          ))}
          {activeTab === "quotes" && data.quotes.map((q) => (
            <QuoteRow key={q.id} quote={q} onToggle={() => toggleApproval("quotes", q.id)} onRemove={() => removeItem("quotes", q.id)} />
          ))}
          {activeTab === "followUps" && data.followUps.map((f) => (
            <FollowUpRow key={f.id} followUp={f} onToggle={() => toggleApproval("followUps", f.id)} onRemove={() => removeItem("followUps", f.id)} />
          ))}

          {(data[activeTab] as unknown[]).length === 0 && (
            <p className="text-center text-muted-foreground py-8">No items found</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t pt-3">
          <p className="text-sm text-muted-foreground">
            {totalApproved} of {totalItems} items approved
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleApprove} disabled={saving || totalApproved === 0}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCheck className="h-4 w-4 mr-2" />}
              Approve & Create ({totalApproved})
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Row Components ──────────────────

function ProjectRow({ project, onToggle, onRemove, onUpdate }: {
  project: StagedProject; onToggle: () => void; onRemove: () => void; onUpdate: (f: string, v: string) => void;
}) {
  return (
    <div className={`border rounded-lg p-3 space-y-2 ${!project.approved ? "opacity-40" : ""}`}>
      <div className="flex items-center gap-2">
        <button onClick={onToggle} className={`h-5 w-5 rounded border flex items-center justify-center shrink-0 ${project.approved ? "bg-green-500 border-green-500" : "border-muted-foreground"}`}>
          {project.approved && <Check className="h-3 w-3 text-white" />}
        </button>
        <Input value={project.name} onChange={(e) => onUpdate("name", e.target.value)} className="font-medium h-8" />
        <Badge variant="outline" className="shrink-0 text-[10px]">{project.status}</Badge>
        <Badge variant="outline" className="shrink-0 text-[10px]">{project.project_type}</Badge>
        <button onClick={onRemove} className="text-red-400 hover:text-red-300 shrink-0"><Trash2 className="h-4 w-4" /></button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Input value={project.address || ""} onChange={(e) => onUpdate("address", e.target.value)} placeholder="Address" className="h-7 text-xs" />
        <Input value={project.city || ""} onChange={(e) => onUpdate("city", e.target.value)} placeholder="City" className="h-7 text-xs" />
        <Input value={project.customer_name || ""} onChange={(e) => onUpdate("customer_name", e.target.value)} placeholder="Client name" className="h-7 text-xs" />
      </div>
      {project.description && <p className="text-xs text-muted-foreground line-clamp-2">{project.description}</p>}
    </div>
  );
}

function CustomerRow({ customer, onToggle, onRemove, onUpdate }: {
  customer: StagedCustomer; onToggle: () => void; onRemove: () => void; onUpdate: (f: string, v: string) => void;
}) {
  return (
    <div className={`border rounded-lg p-3 ${!customer.approved ? "opacity-40" : ""}`}>
      <div className="flex items-center gap-2">
        <button onClick={onToggle} className={`h-5 w-5 rounded border flex items-center justify-center shrink-0 ${customer.approved ? "bg-green-500 border-green-500" : "border-muted-foreground"}`}>
          {customer.approved && <Check className="h-3 w-3 text-white" />}
        </button>
        <Input value={customer.first_name} onChange={(e) => onUpdate("first_name", e.target.value)} placeholder="First" className="h-8 w-32" />
        <Input value={customer.last_name} onChange={(e) => onUpdate("last_name", e.target.value)} placeholder="Last" className="h-8 w-32" />
        <Input value={customer.email || ""} onChange={(e) => onUpdate("email", e.target.value)} placeholder="Email" className="h-8 flex-1" />
        <Input value={customer.phone || ""} onChange={(e) => onUpdate("phone", e.target.value)} placeholder="Phone" className="h-8 w-36" />
        <button onClick={onRemove} className="text-red-400 hover:text-red-300 shrink-0"><Trash2 className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

function SubRow({ sub, onToggle, onRemove, onUpdate }: {
  sub: StagedSub; onToggle: () => void; onRemove: () => void; onUpdate: (f: string, v: string) => void;
}) {
  return (
    <div className={`border rounded-lg p-3 ${!sub.approved ? "opacity-40" : ""}`}>
      <div className="flex items-center gap-2">
        <button onClick={onToggle} className={`h-5 w-5 rounded border flex items-center justify-center shrink-0 ${sub.approved ? "bg-green-500 border-green-500" : "border-muted-foreground"}`}>
          {sub.approved && <Check className="h-3 w-3 text-white" />}
        </button>
        <Input value={sub.company_name} onChange={(e) => onUpdate("company_name", e.target.value)} placeholder="Company" className="h-8 flex-1" />
        <Input value={sub.contact_name || ""} onChange={(e) => onUpdate("contact_name", e.target.value)} placeholder="Contact" className="h-8 w-36" />
        <Input value={sub.email || ""} onChange={(e) => onUpdate("email", e.target.value)} placeholder="Email" className="h-8 w-48" />
        <div className="flex flex-wrap gap-1 shrink-0">
          {sub.trades.map((t) => <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>)}
        </div>
        <button onClick={onRemove} className="text-red-400 hover:text-red-300 shrink-0"><Trash2 className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

function QuoteRow({ quote, onToggle, onRemove }: {
  quote: StagedQuote; onToggle: () => void; onRemove: () => void;
}) {
  return (
    <div className={`border rounded-lg p-3 ${!quote.approved ? "opacity-40" : ""}`}>
      <div className="flex items-center gap-2">
        <button onClick={onToggle} className={`h-5 w-5 rounded border flex items-center justify-center shrink-0 ${quote.approved ? "bg-green-500 border-green-500" : "border-muted-foreground"}`}>
          {quote.approved && <Check className="h-3 w-3 text-white" />}
        </button>
        <span className="font-medium text-sm">{quote.subcontractor_name}</span>
        <Badge variant="secondary" className="text-[10px] bg-amber-500/20 text-amber-400">{quote.project_name}</Badge>
        {quote.trade && <Badge variant="outline" className="text-[10px]">{quote.trade}</Badge>}
        {quote.amount && <span className="text-sm text-green-400 ml-auto">${quote.amount.toLocaleString()}</span>}
        <Badge variant="outline" className="text-[10px]">{quote.status}</Badge>
        <button onClick={onRemove} className="text-red-400 hover:text-red-300 shrink-0"><Trash2 className="h-4 w-4" /></button>
      </div>
      {quote.scope_description && <p className="text-xs text-muted-foreground mt-1 ml-7">{quote.scope_description}</p>}
    </div>
  );
}

function FollowUpRow({ followUp, onToggle, onRemove }: {
  followUp: StagedFollowUp; onToggle: () => void; onRemove: () => void;
}) {
  const priorityColors: Record<string, string> = {
    urgent: "text-red-400", high: "text-orange-400", medium: "text-yellow-400", low: "text-blue-400",
  };

  return (
    <div className={`border rounded-lg p-3 ${!followUp.approved ? "opacity-40" : ""}`}>
      <div className="flex items-center gap-2">
        <button onClick={onToggle} className={`h-5 w-5 rounded border flex items-center justify-center shrink-0 ${followUp.approved ? "bg-green-500 border-green-500" : "border-muted-foreground"}`}>
          {followUp.approved && <Check className="h-3 w-3 text-white" />}
        </button>
        <span className="font-medium text-sm">{followUp.contact_name}</span>
        {followUp.project_name && <Badge variant="secondary" className="text-[10px] bg-amber-500/20 text-amber-400">{followUp.project_name}</Badge>}
        <Badge variant="outline" className={`text-[10px] ${priorityColors[followUp.priority] || ""}`}>{followUp.priority}</Badge>
        <button onClick={onRemove} className="text-red-400 hover:text-red-300 shrink-0 ml-auto"><Trash2 className="h-4 w-4" /></button>
      </div>
      <p className="text-xs text-muted-foreground mt-1 ml-7">{followUp.description}</p>
    </div>
  );
}
