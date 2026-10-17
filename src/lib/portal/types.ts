// Shapes the client portal API returns and the portal page renders. Shared by
// /api/portal (client), /api/portal/preview (staff) and the portal view.

export interface SelectionOption { id: string; label: string; description?: string; image_url?: string; price_delta?: number }

/** A decision row from client_selections (option picker / owner-supplied). */
export interface PortalDecision {
  id: string;
  category: string;
  description: string | null;
  status: "pending" | "selected";
  allowance_amount: number | null;
  options: SelectionOption[];
  selected_option_id: string | null;
  selected_value: string | null;
  sort_order: number;
  /** Preview only: false = hidden from the client. */
  client_visible?: boolean;
  /** The client tapped Done / Not needed on their portal. */
  client_done_at?: string | null;
  client_dismissed_at?: string | null;
}

export type SelectionItemStatus = "selected" | "proposed" | "pending" | "reused" | "ordered" | "installed";

export interface PortalSelectionItem {
  id: string;
  section: string | null;
  status: SelectionItemStatus;
  status_label: string | null;
  name: string;
  brand_model: string | null;
  details: string | null;
  image_url: string | null;
  product_url: string | null;
  link_label: string | null;
  quantity: string | null;
  unit_price: string | null;
  ext_price: number | null;
  price_note: string | null;
  /** The client tapped Approve or Remove on their portal. */
  client_action: "approved" | "removed" | null;
}

export interface PortalAllowanceRow {
  name: string;
  allowance: number;
  /** null = still pending */
  selected: number | null;
  status: string;
}

export interface PortalSelectionSheet {
  id: string;
  title: string;
  revision: string | null;
  sheet_date: string | null;
  intro: string | null;
  pdf_url: string | null;
  show_prices: boolean;
  /** Preview only: true = not published yet. */
  staged: boolean;
  published_at: string | null;
  allowances: PortalAllowanceRow[];
  allowance_note: string | null;
  notes: { title: string; body: string }[];
  items: PortalSelectionItem[];
}

export type PortalDocumentGroup =
  | "design" | "selections" | "contract" | "change_order" | "invoice" | "permit" | "other" | "drawing";

export interface PortalDocument {
  id: string;
  group: PortalDocumentGroup;
  title: string;
  subtitle: string | null;
  date: string | null;
  url: string;
  staged: boolean;
}

export interface PortalNeed {
  kind: "contract" | "change_order" | "decision";
  title: string;
  detail?: string | null;
  url?: string | null;
  tab?: "selections";
}

export interface PortalPhase {
  actual_completion_date?: string | null;
  id: string; name: string; description: string | null; start_date: string | null; end_date: string | null;
  status: string | null; color: string | null; firm: boolean; event_type?: string | null; sort_order?: number | null;
  /** The client marked it complete on their portal (board status unchanged). */
  client_completed?: boolean;
}

export interface PortalChangeOrder {
  id: string; change_order_number: number; title: string; description: string | null; status: string;
  price_impact: number; signed: boolean; sent_at: string | null; approval_token: string | null; url: string | null;
}

export interface PortalPayment {
  id: string; payment_type: string; description: string | null; amount: number;
  received_date: string | null; invoice_sent_number: string | null;
}

export interface PortalInvoice { id: string; invoice_number: number; title: string | null; amount: number; date: string; url: string }

export interface PortalFinancials {
  contract_value: number; adjusted_contract: number; total_payments_received: number;
  deposit_received: number; draws_received: number; final_received: number;
  outstanding_receivable: number; change_order_count: number; change_order_revenue: number;
}

export interface PortalPhoto { thumb: string; full: string; date: string }
export interface PortalDayPlan { planned_count: number; tasks: { name: string; description: string | null }[] }
export interface PortalTodayOnSite {
  date: string; live_count: number; planned_count: number;
  tasks: { name: string; description: string | null }[]; tomorrow?: PortalDayPlan;
}

export interface PortalMeta {
  exists: boolean;
  enabled: boolean;
  client_email: string | null;
  link_sent_at: string | null;
  view_count: number;
}

export interface PortalData {
  mode: "client" | "preview";
  client_name: string | null;
  /** Preview only: the project's portal link state. */
  portal?: PortalMeta;
  today_on_site: PortalTodayOnSite | null;
  project: { name: string; project_number: string; address: string; status: string };
  financials: PortalFinancials | null;
  schedule: PortalPhase[];
  payments: PortalPayment[];
  change_orders: PortalChangeOrder[];
  invoices: PortalInvoice[];
  selections: PortalDecision[];
  selection_sheet: PortalSelectionSheet | null;
  documents: PortalDocument[];
  needed: PortalNeed[];
  photos: PortalPhoto[];
}
