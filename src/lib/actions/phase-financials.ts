"use server";

import { createClient } from "@/lib/supabase/server";

export interface PhaseFinancials {
  // Budget (from linked estimate line item)
  budget: {
    description: string;
    trade: string | null;
    budgeted_cost: number;
    client_price: number;
    scope_text: string | null;
  } | null;

  // Invoices linked to this budget line (money out)
  invoices: {
    id: string;
    vendor_name: string;
    trade: string | null;
    amount: number;
    paid_amount: number;
    payment_status: string;
    invoice_number: string | null;
    invoice_date: string | null;
  }[];

  // Time entries logged on this phase (crew labor)
  labor: {
    id: string;
    employee_name: string;
    hourly_rate: number;
    hours: number;
    cost: number;
    clock_in: string;
    clock_out: string | null;
  }[];

  // Totals
  totalInvoiced: number;
  totalLabor: number;
  totalSpent: number;
  budgetRemaining: number;
}

export async function getPhaseFinancials(phaseId: string): Promise<PhaseFinancials> {
  const supabase = await createClient();

  // Get the phase with its estimate_line_item_id
  const { data: phase } = await supabase
    .from("schedule_phases")
    .select("id, estimate_line_item_id, project_id")
    .eq("id", phaseId)
    .single();

  if (!phase) {
    return emptyResult();
  }

  // Fetch budget line, invoices, and time entries in parallel
  const [budgetRes, invoicesRes, timeRes] = await Promise.all([
    // Budget from estimate line item
    phase.estimate_line_item_id
      ? supabase
          .from("estimate_line_items")
          .select("description, trade, total_cost, cost, client_price, scope_text")
          .eq("id", phase.estimate_line_item_id)
          .single()
      : Promise.resolve({ data: null }),

    // Invoices linked to this budget line
    phase.estimate_line_item_id
      ? supabase
          .from("invoices")
          .select("id, vendor_name, trade, amount, paid_amount, payment_status, invoice_number, invoice_date")
          .eq("estimate_line_item_id", phase.estimate_line_item_id)
          .order("invoice_date", { ascending: false })
      : Promise.resolve({ data: [] }),

    // Time entries on this phase
    supabase
      .from("time_entries")
      .select("id, clock_in, clock_out, break_minutes, employee_id, employees(first_name, last_name, hourly_rate)")
      .eq("schedule_phase_id", phaseId)
      .order("clock_in", { ascending: false }),
  ]);

  // Process budget
  const budgetLine = budgetRes.data;
  const budget = budgetLine
    ? {
        description: budgetLine.description,
        trade: budgetLine.trade,
        budgeted_cost: Number(budgetLine.total_cost || budgetLine.cost || 0),
        client_price: Number(budgetLine.client_price || 0),
        scope_text: budgetLine.scope_text,
      }
    : null;

  // Process invoices
  const invoices = (invoicesRes.data || []).map((inv) => ({
    id: inv.id,
    vendor_name: inv.vendor_name,
    trade: inv.trade,
    amount: Number(inv.amount || 0),
    paid_amount: Number(inv.paid_amount || 0),
    payment_status: inv.payment_status,
    invoice_number: inv.invoice_number,
    invoice_date: inv.invoice_date,
  }));

  // Process time entries
  const labor = (timeRes.data || [])
    .filter((te) => te.clock_out) // Only completed entries
    .map((te) => {
      const emp = Array.isArray(te.employees) ? te.employees[0] : te.employees;
      const ms = new Date(te.clock_out!).getTime() - new Date(te.clock_in).getTime();
      const hours = Math.max(0, ms / 3600000 - (te.break_minutes || 0) / 60);
      const rate = Number(emp?.hourly_rate || 0);
      return {
        id: te.id,
        employee_name: emp ? `${emp.first_name} ${emp.last_name}` : "Unknown",
        hourly_rate: rate,
        hours: Math.round(hours * 10) / 10,
        cost: Math.round(hours * rate * 100) / 100,
        clock_in: te.clock_in,
        clock_out: te.clock_out,
      };
    });

  // Calculate totals
  const totalInvoiced = invoices.reduce((sum, inv) => sum + inv.amount, 0);
  const totalLabor = labor.reduce((sum, l) => sum + l.cost, 0);
  const totalSpent = totalInvoiced + totalLabor;
  const budgetedCost = budget?.budgeted_cost || 0;
  const budgetRemaining = budgetedCost - totalSpent;

  return {
    budget,
    invoices,
    labor,
    totalInvoiced,
    totalLabor,
    totalSpent,
    budgetRemaining,
  };
}

function emptyResult(): PhaseFinancials {
  return {
    budget: null,
    invoices: [],
    labor: [],
    totalInvoiced: 0,
    totalLabor: 0,
    totalSpent: 0,
    budgetRemaining: 0,
  };
}
