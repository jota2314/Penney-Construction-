"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Receipt,
  CheckCircle2,
  Clock,
  AlertCircle,
  ExternalLink,
  Trash2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { updateInvoicePayment, deleteInvoice } from "@/lib/actions/invoices";
import type { Invoice } from "@/types/database";

interface ProjectInvoicesTabProps {
  invoices: Invoice[];
  projectName: string;
}

const STATUS_CONFIG = {
  unpaid: { label: "Unpaid", color: "bg-red-500/15 text-red-500 border-red-500/30", icon: AlertCircle },
  partial: { label: "Partial", color: "bg-amber-500/15 text-amber-500 border-amber-500/30", icon: Clock },
  paid: { label: "Paid", color: "bg-green-500/15 text-green-500 border-green-500/30", icon: CheckCircle2 },
};

export function ProjectInvoicesTab({ invoices: initialInvoices, projectName }: ProjectInvoicesTabProps) {
  const [invoices, setInvoices] = useState(initialInvoices);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const totalInvoiced = invoices.reduce((sum, i) => sum + Number(i.amount), 0);
  const totalPaid = invoices.reduce((sum, i) => sum + Number(i.paid_amount), 0);
  const outstanding = totalInvoiced - totalPaid;
  const unpaidCount = invoices.filter(i => i.payment_status !== "paid").length;

  function handleMarkPaid(invoiceId: string) {
    startTransition(async () => {
      const result = await updateInvoicePayment(invoiceId, "paid");
      if (result.success) {
        setInvoices(prev => prev.map(i =>
          i.id === invoiceId ? { ...i, payment_status: "paid" as const, paid_amount: i.amount, paid_date: new Date().toISOString().split("T")[0] } : i
        ));
      }
    });
  }

  function handleMarkUnpaid(invoiceId: string) {
    startTransition(async () => {
      const result = await updateInvoicePayment(invoiceId, "unpaid");
      if (result.success) {
        setInvoices(prev => prev.map(i =>
          i.id === invoiceId ? { ...i, payment_status: "unpaid" as const, paid_amount: 0, paid_date: null } : i
        ));
      }
    });
  }

  function handleDelete(invoiceId: string) {
    startTransition(async () => {
      const result = await deleteInvoice(invoiceId);
      if (result.success) {
        setInvoices(prev => prev.filter(i => i.id !== invoiceId));
      }
    });
  }

  if (invoices.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Receipt className="h-12 w-12 text-muted-foreground/30 mb-3" />
        <h3 className="font-medium text-muted-foreground">No invoices yet</h3>
        <p className="text-sm text-muted-foreground/70 mt-1 max-w-sm">
          Invoices will appear here when the AI identifies them during email triage, or you can add them manually.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border bg-card p-3">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Total Invoiced</div>
          <div className="text-lg font-bold text-foreground mt-0.5">{formatCurrency(totalInvoiced)}</div>
        </div>
        <div className="rounded-xl border bg-card p-3">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Paid</div>
          <div className="text-lg font-bold text-green-500 mt-0.5">{formatCurrency(totalPaid)}</div>
        </div>
        <div className="rounded-xl border bg-card p-3">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Outstanding</div>
          <div className={`text-lg font-bold mt-0.5 ${outstanding > 0 ? "text-red-500" : "text-muted-foreground"}`}>
            {formatCurrency(outstanding)}
          </div>
        </div>
        <div className="rounded-xl border bg-card p-3">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Unpaid</div>
          <div className={`text-lg font-bold mt-0.5 ${unpaidCount > 0 ? "text-amber-500" : "text-muted-foreground"}`}>
            {unpaidCount} invoice{unpaidCount !== 1 ? "s" : ""}
          </div>
        </div>
      </div>

      {/* ── Invoice List ── */}
      <div className="space-y-2">
        {invoices.map((invoice) => {
          const isExpanded = expandedId === invoice.id;
          const config = STATUS_CONFIG[invoice.payment_status];
          const StatusIcon = config.icon;

          return (
            <div key={invoice.id} className="rounded-xl border bg-card overflow-hidden">
              {/* Header Row */}
              <button
                onClick={() => setExpandedId(isExpanded ? null : invoice.id)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
              >
                <div className="h-10 w-10 rounded-lg bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center shrink-0">
                  <Receipt className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {invoice.vendor_name}
                    {invoice.invoice_number && (
                      <span className="text-muted-foreground font-normal"> #{invoice.invoice_number}</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {invoice.trade && <span>{invoice.trade} · </span>}
                    {invoice.invoice_date && <span>{formatDate(invoice.invoice_date)} · </span>}
                    {invoice.terms && <span>{invoice.terms}</span>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-semibold">{formatCurrency(Number(invoice.amount), "two")}</div>
                  <Badge variant="outline" className={`text-[9px] ${config.color}`}>
                    <StatusIcon className="h-2.5 w-2.5 mr-0.5" />
                    {config.label}
                  </Badge>
                </div>
                {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
              </button>

              {/* Expanded Detail */}
              {isExpanded && (
                <div className="px-4 pb-4 pt-1 border-t space-y-3">
                  {/* Details Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                    {invoice.vendor_type && (
                      <div>
                        <span className="text-muted-foreground">Type:</span>{" "}
                        <span className="capitalize">{invoice.vendor_type}</span>
                      </div>
                    )}
                    {invoice.due_date && (
                      <div>
                        <span className="text-muted-foreground">Due:</span>{" "}
                        {formatDate(invoice.due_date)}
                      </div>
                    )}
                    {invoice.paid_date && (
                      <div>
                        <span className="text-muted-foreground">Paid:</span>{" "}
                        {formatDate(invoice.paid_date)}
                      </div>
                    )}
                    {invoice.paid_amount > 0 && invoice.payment_status !== "paid" && (
                      <div>
                        <span className="text-muted-foreground">Paid so far:</span>{" "}
                        {formatCurrency(Number(invoice.paid_amount), "two")}
                      </div>
                    )}
                  </div>

                  {/* Description */}
                  {invoice.description && (
                    <div className="text-xs">
                      <span className="text-muted-foreground">Description:</span>{" "}
                      {invoice.description}
                    </div>
                  )}

                  {/* Extracted Text */}
                  {invoice.extracted_text && (
                    <div className="rounded-lg bg-muted/50 p-3 text-xs max-h-40 overflow-y-auto whitespace-pre-wrap font-mono">
                      {invoice.extracted_text}
                    </div>
                  )}

                  {/* Notes */}
                  {invoice.notes && (
                    <div className="text-xs">
                      <span className="text-muted-foreground">Notes:</span> {invoice.notes}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-1">
                    {invoice.payment_status !== "paid" ? (
                      <Button
                        size="sm"
                        variant="default"
                        className="h-7 text-xs bg-green-600 hover:bg-green-700"
                        onClick={() => handleMarkPaid(invoice.id)}
                        disabled={isPending}
                      >
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Mark Paid
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => handleMarkUnpaid(invoice.id)}
                        disabled={isPending}
                      >
                        Undo Payment
                      </Button>
                    )}
                    {invoice.attachment_storage_path && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={async () => {
                          const supabase = createClient();
                          const { data } = await supabase.storage
                            .from("email-attachments")
                            .createSignedUrl(invoice.attachment_storage_path!, 3600);
                          if (data?.signedUrl) window.open(data.signedUrl, "_blank");
                        }}
                      >
                        <ExternalLink className="h-3 w-3 mr-1" />
                        View PDF
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-red-500 hover:text-red-600 ml-auto"
                      onClick={() => handleDelete(invoice.id)}
                      disabled={isPending}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
