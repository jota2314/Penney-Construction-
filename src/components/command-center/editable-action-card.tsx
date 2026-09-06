"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CheckCircle,
  AlertCircle,
  Loader2,
  Pencil,
  Save,
  X,
  Send,
  FileText,
} from "lucide-react";
import type { ProposedAction } from "@/components/command-center/email-detail-types";
import { ACTION_ICONS } from "@/components/command-center/email-detail-types";

// Field definitions for each action type
const ACTION_FIELDS: Record<string, { key: string; label: string; type?: "text" | "number" | "date" | "textarea" | "select"; options?: string[] }[]> = {
  create_project: [
    { key: "name", label: "Project Name" },
    { key: "customer_name", label: "Customer" },
    { key: "address", label: "Address" },
    { key: "city", label: "City" },
    { key: "state", label: "State" },
    { key: "project_type", label: "Type", type: "select", options: ["residential", "commercial", "renovation", "addition", "new_construction", "kitchen", "bathroom", "roofing", "siding", "other"] },
    { key: "status", label: "Status", type: "select", options: ["lead", "estimating", "proposal_sent", "contracted", "in_progress", "audit", "completed", "cancelled"] },
    { key: "estimated_value", label: "Estimated Value", type: "number" },
    { key: "description", label: "Description", type: "textarea" },
    { key: "scope_of_work", label: "Scope of Work", type: "textarea" },
  ],
  update_project: [
    { key: "project_name", label: "Project" },
    { key: "address", label: "Address" },
    { key: "status", label: "Status", type: "select", options: ["lead", "estimating", "proposal_sent", "contracted", "in_progress", "audit", "completed", "cancelled"] },
    { key: "estimated_value", label: "Estimated Value", type: "number" },
    { key: "contract_value", label: "Contract Value", type: "number" },
    { key: "description", label: "Description", type: "textarea" },
    { key: "scope_of_work", label: "Scope of Work", type: "textarea" },
  ],
  create_customer: [
    { key: "first_name", label: "First Name" },
    { key: "last_name", label: "Last Name" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "address", label: "Address" },
    { key: "city", label: "City" },
    { key: "state", label: "State" },
  ],
  create_subcontractor: [
    { key: "company_name", label: "Company" },
    { key: "contact_name", label: "Contact Name" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "trades", label: "Trades (comma separated)" },
  ],
  create_quote: [
    { key: "subcontractor_name", label: "Subcontractor" },
    { key: "project_name", label: "Project" },
    { key: "trade", label: "Trade" },
    { key: "amount", label: "Amount", type: "number" },
    { key: "status", label: "Status", type: "select", options: ["just_sent", "awaiting_reply", "received", "accepted", "declined", "approved"] },
    { key: "scope_description", label: "Scope", type: "textarea" },
    { key: "document_type", label: "Doc Type", type: "select", options: ["quote", "estimate", "proposal", "invoice", "change_order"] },
  ],
  create_invoice: [
    { key: "vendor_name", label: "Vendor" },
    { key: "project_name", label: "Project" },
    { key: "trade", label: "Trade" },
    { key: "amount", label: "Amount", type: "number" },
    { key: "invoice_number", label: "Invoice #" },
    { key: "invoice_date", label: "Invoice Date", type: "date" },
    { key: "due_date", label: "Due Date", type: "date" },
    { key: "description", label: "Description", type: "textarea" },
    { key: "vendor_type", label: "Vendor Type", type: "select", options: ["subcontractor", "supplier", "vendor", "other"] },
  ],
  record_payment: [
    { key: "project_name", label: "Project" },
    { key: "payment_type", label: "Type", type: "select", options: ["deposit", "draw", "progress", "final", "change_order", "retainage", "other"] },
    { key: "amount", label: "Amount", type: "number" },
    { key: "received_date", label: "Date", type: "date" },
    { key: "method", label: "Method", type: "select", options: ["check", "wire", "ach", "credit_card", "cash", "other"] },
    { key: "reference_number", label: "Reference #" },
    { key: "description", label: "Description", type: "textarea" },
  ],
  create_change_order: [
    { key: "project_name", label: "Project" },
    { key: "title", label: "Title" },
    { key: "cost_impact", label: "Cost Impact ($)", type: "number" },
    { key: "price_impact", label: "Price Impact ($)", type: "number" },
    { key: "status", label: "Status", type: "select", options: ["pending", "approved", "declined"] },
    { key: "description", label: "Description", type: "textarea" },
  ],
  create_todo: [
    { key: "description", label: "Description", type: "textarea" },
    { key: "project_name", label: "Project" },
    { key: "contact_name", label: "Contact" },
    { key: "priority", label: "Priority", type: "select", options: ["low", "medium", "high", "urgent"] },
    { key: "category", label: "Category", type: "select", options: ["quotes", "estimates", "scheduling", "follow_up_quotes", "follow_up_clients", "permits_inspections", "materials", "change_orders", "payments", "contracts_docs", "general"] },
    { key: "due_date", label: "Due Date", type: "date" },
  ],
  schedule_event: [
    { key: "name", label: "Event Name" },
    { key: "project_name", label: "Project" },
    { key: "event_type", label: "Type", type: "select", options: ["meeting", "walkthrough", "inspection", "phase"] },
    { key: "start_datetime", label: "Start" },
    { key: "end_datetime", label: "End" },
    { key: "location", label: "Location" },
    { key: "description", label: "Description", type: "textarea" },
  ],
  link_email_to_project: [
    { key: "project_name", label: "Project" },
  ],
  save_project_file: [
    { key: "project_name", label: "Project" },
    { key: "filename", label: "Filename" },
    { key: "category", label: "Category", type: "select", options: ["construction_drawings", "specs", "pricing", "contracts", "permits", "photos", "invoices", "estimates", "other"] },
    { key: "description", label: "Description" },
  ],
};

interface EditableActionCardProps {
  action: ProposedAction;
  onApprove: (editedData?: Record<string, unknown>) => void;
  onEditDraft: () => void;
}

export function EditableActionCard({ action, onApprove, onEditDraft }: EditableActionCardProps) {
  const [editing, setEditing] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [editData, setEditData] = useState<Record<string, any>>({ ...action.data });
  const Icon = ACTION_ICONS[action.type] || FileText;
  const fields = ACTION_FIELDS[action.type] || [];

  function handleEdit() {
    setEditData({ ...action.data });
    setEditing(true);
  }

  function handleCancel() {
    setEditing(false);
    setEditData({ ...action.data });
  }

  function handleSave() {
    setEditing(false);
    onApprove(editData);
  }

  function handleFieldChange(key: string, value: string, type?: string) {
    setEditData(prev => ({
      ...prev,
      [key]: type === "number" ? (value === "" ? null : Number(value)) : value,
    }));
  }

  // Collapsed summary (non-editing state)
  const summaryLine: React.ReactNode = getSummary(action);

  return (
    <div className="border rounded-xl p-3 bg-background/50 space-y-2">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-1.5 rounded-lg bg-amber-500/10 shrink-0">
            <Icon className="h-4 w-4 text-amber-500" />
          </div>
          <span className="text-sm font-medium truncate">{action.label}</span>
        </div>

        {/* Buttons */}
        {action.status === "pending" && !editing && (
          <div className="flex items-center gap-1.5 shrink-0">
            {action.type === "draft_reply" || action.type === "draft_email" || action.type === "send_email" ? (
              <>
                <Button size="sm" variant="outline" className="text-xs h-8 px-3 bg-blue-500/10 border-blue-500/30 text-blue-400 hover:bg-blue-500/20" onClick={onEditDraft}>
                  <Pencil className="h-3 w-3 mr-1" /> Edit & Send
                </Button>
                <Button size="sm" variant="outline" className="text-xs h-8 px-2" onClick={() => onApprove()} title="Send without editing">
                  <Send className="h-3 w-3" />
                </Button>
              </>
            ) : (
              <>
                {fields.length > 0 && (
                  <Button size="sm" variant="ghost" className="text-xs h-8 px-2 text-muted-foreground hover:text-foreground" onClick={handleEdit} title="Edit before saving">
                    <Pencil className="h-3 w-3" />
                  </Button>
                )}
                <Button size="sm" variant="outline" className="text-xs h-8 px-3 shrink-0" onClick={() => onApprove()}>
                  Approve
                </Button>
              </>
            )}
          </div>
        )}
        {action.status === "pending" && editing && (
          <div className="flex items-center gap-1.5 shrink-0">
            <Button size="sm" variant="ghost" className="text-xs h-8 px-2 text-muted-foreground" onClick={handleCancel}>
              <X className="h-3 w-3" />
            </Button>
            <Button size="sm" className="text-xs h-8 px-3 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleSave}>
              <Save className="h-3 w-3 mr-1" /> Save
            </Button>
          </div>
        )}
        {action.status === "executing" && <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500 shrink-0" />}
        {action.status === "approved" && <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />}
        {action.status === "error" && <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />}
      </div>

      {/* Summary (when not editing) */}
      {!editing && (
        <div className="text-xs text-muted-foreground ml-8 space-y-0.5">
          {summaryLine}
        </div>
      )}

      {editing ? renderEditFields(fields, editData, handleFieldChange) : null}

      {/* Error message */}
      {action.status === "error" && (
        <p className="text-xs text-red-400 ml-8">{String(action.error ?? "Action failed")}</p>
      )}

      {/* Draft preview */}
      {!editing && (action.type === "draft_reply" || action.type === "draft_email" || action.type === "send_email") && !!action.data.body && (
        <div className="ml-8 mt-1.5 p-2.5 rounded-lg bg-muted text-xs text-muted-foreground whitespace-pre-wrap max-h-32 overflow-y-auto">
          {String(action.data.body)}
        </div>
      )}
    </div>
  );
}

function renderEditFields(
  fields: { key: string; label: string; type?: string; options?: string[] }[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editData: Record<string, any>,
  onChange: (key: string, value: string, type?: string) => void,
): React.ReactElement {
  return (
    <div className="ml-8 space-y-2 pt-1">
      {fields.map((field) => {
        const strVal = editData[field.key] != null ? String(editData[field.key]) : "";
        if (field.type === "select") {
          return (
            <div key={field.key} className="space-y-0.5">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">{field.label}</label>
              <select value={strVal} onChange={(e) => onChange(field.key, e.target.value)}
                className="w-full h-8 px-2 text-xs rounded-md border bg-background text-foreground">
                <option value="">—</option>
                {field.options?.map((opt) => <option key={opt} value={opt}>{opt.replace(/_/g, " ")}</option>)}
              </select>
            </div>
          );
        }
        if (field.type === "textarea") {
          return (
            <div key={field.key} className="space-y-0.5">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">{field.label}</label>
              <textarea value={strVal} onChange={(e) => onChange(field.key, e.target.value)} rows={2}
                className="w-full px-2 py-1.5 text-xs rounded-md border bg-background text-foreground resize-none" />
            </div>
          );
        }
        return (
          <div key={field.key} className="space-y-0.5">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">{field.label}</label>
            <Input value={strVal} onChange={(e) => onChange(field.key, e.target.value, field.type)}
              type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
              className="h-8 text-xs" step={field.type === "number" ? "0.01" : undefined} />
          </div>
        );
      })}
    </div>
  );
}

// Summary text for collapsed view
function getSummary(action: { type: string; data: Record<string, unknown> }): React.ReactNode {
  const d = action.data;
  switch (action.type) {
    case "create_project":
      return (
        <>
          {d.status && <span className="capitalize">{String(d.status)}</span>}
          {d.project_type && <> &middot; {String(d.project_type)}</>}
          {d.address && <span className="block">{String(d.address)}{d.city ? `, ${String(d.city)}` : ""}{d.state ? ` ${String(d.state)}` : ""}</span>}
          {d.customer_name && <span className="block">Client: {String(d.customer_name)}</span>}
        </>
      );
    case "update_project":
      return (
        <>
          {d.project_name && <span>Project: {String(d.project_name)}</span>}
          {d.status && <span className="block">Status: {String(d.status)}</span>}
        </>
      );
    case "create_customer":
      return (
        <>
          {d.email && <span>{String(d.email)}</span>}
          {d.phone && <span className="block">{String(d.phone)}</span>}
        </>
      );
    case "create_subcontractor":
      return (
        <>
          {d.contact_name && <span>{String(d.contact_name)}</span>}
          {d.trades && <span className="block">Trades: {Array.isArray(d.trades) ? d.trades.join(", ") : String(d.trades)}</span>}
        </>
      );
    case "create_quote":
      return (
        <>
          {d.project_name && <span>For: {String(d.project_name)}</span>}
          {d.trade && <> &middot; {String(d.trade)}</>}
          {d.amount && <span className="block font-medium text-green-500">${Number(d.amount).toLocaleString()}</span>}
        </>
      );
    case "create_invoice":
      return (
        <>
          {d.project_name && <span>For: {String(d.project_name)}</span>}
          {d.trade && <> &middot; {String(d.trade)}</>}
          {d.amount && <span className="block font-medium text-amber-500">${Number(d.amount).toLocaleString()}</span>}
          {d.invoice_number && <span className="block">Invoice #{String(d.invoice_number)}</span>}
        </>
      );
    case "record_payment":
      return (
        <>
          {d.project_name && <span>{String(d.project_name)}</span>}
          {d.payment_type && <> &middot; {String(d.payment_type)}</>}
          {d.amount && <span className="block font-medium text-green-500">${Number(d.amount).toLocaleString()}</span>}
        </>
      );
    case "create_change_order":
      return (
        <>
          {d.project_name && <span>{String(d.project_name)}</span>}
          {d.cost_impact && <span className="block">Cost: ${Number(d.cost_impact).toLocaleString()}</span>}
          {d.price_impact && <span className="block">Price: ${Number(d.price_impact).toLocaleString()}</span>}
        </>
      );
    case "create_todo":
      return (
        <>
          {d.description && <span className="line-clamp-2">{String(d.description)}</span>}
          {d.priority && <span className="block capitalize">Priority: {String(d.priority)}</span>}
        </>
      );
    case "schedule_event":
      return (
        <>
          {d.event_type && <span className="capitalize">{String(d.event_type)}</span>}
          {d.project_name && <> &middot; {String(d.project_name)}</>}
        </>
      );
    case "link_email_to_project":
      return d.project_name ? <span>Link to: {String(d.project_name)}</span> : null;
    case "save_project_file":
      return (
        <>
          {d.filename && <span>{String(d.filename)}</span>}
          {d.category && <> &middot; {String(d.category).replace(/_/g, " ")}</>}
        </>
      );
    default:
      return Object.entries(d).filter(([, v]) => v != null).map(([k, v]) => (
        <span key={k} className="block">{k}: {String(v)}</span>
      ));
  }
}
