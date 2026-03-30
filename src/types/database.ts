import type { UserRole } from "./auth";

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  role: UserRole;
  phone: string | null;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type ProjectStatus =
  | "lead"
  | "estimating"
  | "proposal_sent"
  | "contracted"
  | "in_progress"
  | "completed"
  | "cancelled";

export type ProjectType =
  | "remodel"
  | "addition"
  | "kitchen"
  | "bathroom"
  | "new_construction"
  | "other";

export interface Project {
  id: string;
  project_number: string;
  name: string;
  customer_id: string | null;
  status: ProjectStatus;
  project_type: ProjectType;
  description: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  estimated_start_date: string | null;
  estimated_end_date: string | null;
  actual_start_date: string | null;
  actual_end_date: string | null;
  estimated_value: number | null;
  contract_value: number | null;
  assigned_pm: string | null;
  assigned_estimator: string | null;
  phase: "preconstruction" | "pre_start" | "rough_in" | "finishing" | "punch_list" | "complete" | null;
  scope_of_work: string | null;
  required_trades: unknown;
  notes: string | null;
  referral_source: string | null;
  referral_detail: string | null;
  walkthrough_scheduled_at: string | null;
  walkthrough_assigned_to: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CostCodeCategory {
  id: string;
  code: string;
  name: string;
  description: string | null;
  sort_order: number;
  created_at: string;
}

export interface CostCode {
  id: string;
  category_id: string;
  code: string;
  name: string;
  description: string | null;
  default_unit: string | null;
  default_unit_cost: number | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type EstimateStatus = "draft" | "review" | "approved" | "superseded";

export interface Estimate {
  id: string;
  project_id: string | null;
  lead_id: string | null;
  version: number;
  name: string;
  status: EstimateStatus;
  description: string | null;
  notes: string | null;
  total_cost: number;
  markup_percentage: number;
  total_price: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface EstimateLineItem {
  id: string;
  estimate_id: string;
  cost_code_id: string | null;
  description: string;
  quantity: number;
  unit: string;
  unit_cost: number;
  total_cost: number;
  markup_percentage: number;
  total_price: number;
  is_visible_on_proposal: boolean;
  proposal_description: string | null;
  sort_order: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface BudgetTemplate {
  id: string;
  name: string;
  description: string | null;
  project_type: ProjectType | null;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface BudgetTemplateItem {
  id: string;
  template_id: string;
  cost_code_id: string | null;
  description: string;
  quantity: number;
  unit: string;
  unit_cost: number;
  sort_order: number;
  created_at: string;
}

export type ProjectFileCategory =
  | "construction_drawings"
  | "specs"
  | "pricing"
  | "contracts"
  | "permits"
  | "photos"
  | "invoices"
  | "estimates"
  | "other";

export interface ProjectFile {
  id: string;
  project_id: string;
  filename: string;
  storage_path: string;
  mime_type: string | null;
  size: number;
  category: ProjectFileCategory;
  description: string | null;
  uploaded_by: string | null;
  created_at: string;
}

export type InvoicePaymentStatus = "unpaid" | "partial" | "paid";
export type InvoiceVendorType = "subcontractor" | "supplier" | "vendor" | "other";

export interface Invoice {
  id: string;
  project_id: string | null;
  vendor_name: string;
  vendor_type: InvoiceVendorType;
  trade: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  terms: string | null;
  description: string | null;
  amount: number;
  paid_amount: number;
  payment_status: InvoicePaymentStatus;
  paid_date: string | null;
  quote_request_id: string | null;
  gmail_message_id: string | null;
  attachment_storage_path: string | null;
  extracted_text: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type VettingStatus = "prospect" | "references_received" | "approved";

export interface Subcontractor {
  id: string;
  company_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  trades: string[];
  license_number: string | null;
  insurance_expiry: string | null;
  rating: number | null;
  notes: string | null;
  is_active: boolean;
  vetting_status: VettingStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectSubcontractor {
  id: string;
  project_id: string;
  subcontractor_id: string;
  contract_amount: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type BidPackageStatus = "draft" | "sent" | "received" | "awarded" | "cancelled";

export interface BidPackage {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  trade: string;
  scope_of_work: string | null;
  due_date: string | null;
  status: BidPackageStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type BidStatus = "invited" | "submitted" | "accepted" | "rejected";

export interface SubcontractorBid {
  id: string;
  bid_package_id: string;
  subcontractor_id: string;
  amount: number | null;
  notes: string | null;
  submitted_at: string | null;
  status: BidStatus;
  is_selected: boolean;
  created_at: string;
  updated_at: string;
}

export type ProposalStatus = "draft" | "sent" | "accepted" | "rejected" | "revised";

export interface Proposal {
  id: string;
  project_id: string;
  estimate_id: string;
  version: number;
  status: ProposalStatus;
  title: string;
  introduction: string | null;
  scope_of_work: string | null;
  exclusions: string | null;
  terms: string | null;
  total_price: number;
  sent_at: string | null;
  responded_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface EstimateFile {
  id: string;
  estimate_id: string;
  storage_path: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  uploaded_by: string;
  created_at: string;
}

export interface ActivityLog {
  id: string;
  user_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

// ── CRM Pipeline ──────────────────────────────────────

export type LeadStatus =
  | "new"
  | "contacted"
  | "meeting_scheduled"
  | "meeting_complete"
  | "estimating"
  | "converted"
  | "lost";

export type ReferralSource =
  | "facebook"
  | "google"
  | "referral"
  | "website"
  | "other";

export type LeadUrgency =
  | "asap"
  | "within_month"
  | "within_3_months"
  | "flexible"
  | "unknown";

export interface Lead {
  id: string;
  lead_number: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  project_type: ProjectType | null;
  description: string | null;
  referral_source: ReferralSource | null;
  referral_detail: string | null;
  budget_min: number | null;
  budget_max: number | null;
  urgency: LeadUrgency;
  timeline_notes: string | null;
  status: LeadStatus;
  lost_reason: string | null;
  customer_id: string | null;
  project_id: string | null;
  estimate_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type MeetingStatus = "scheduled" | "completed" | "cancelled";

export interface Meeting {
  id: string;
  lead_id: string;
  scheduled_at: string;
  completed_at: string | null;
  status: MeetingStatus;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  summary: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type NoteSource = "typed" | "voice";

export interface MeetingNote {
  id: string;
  meeting_id: string;
  content: string;
  source: NoteSource;
  sort_order: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface MeetingFile {
  id: string;
  meeting_id: string;
  storage_path: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  caption: string | null;
  uploaded_by: string;
  created_at: string;
}

export interface LeadFile {
  id: string;
  lead_id: string;
  storage_path: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  uploaded_by: string;
  created_at: string;
}

// ── Employees ──────────────────────────────────────

export type EmployeeStatus = "active" | "inactive";

export interface Employee {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  status: EmployeeStatus;
  hourly_rate: number | null;
  hire_date: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// ── Schedule ──────────────────────────────────────

export type SchedulePhaseStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "on_hold";

export interface SchedulePhase {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string;
  status: SchedulePhaseStatus;
  sort_order: number;
  assigned_employee_ids: string[];
  assigned_sub_ids: string[];
  color: string;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// ── Site Visits (Construction) ──────────────────────────

export type SiteVisitStatus = "in_progress" | "completed";

export type SiteVisitType = "progress" | "punch_list";

export interface SiteVisit {
  id: string;
  project_id: string;
  visited_at: string;
  status: SiteVisitStatus;
  visit_type: SiteVisitType;
  purpose: string | null;
  summary: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface SiteVisitNote {
  id: string;
  site_visit_id: string;
  content: string;
  source: NoteSource;
  sort_order: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface SiteVisitFile {
  id: string;
  site_visit_id: string;
  storage_path: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  caption: string | null;
  uploaded_by: string;
  created_at: string;
}

// ── Walkthroughs (Pre-Con) ──────────────────────────────

export type WalkthroughStatus = "in_progress" | "completed";

export interface Walkthrough {
  id: string;
  name: string;
  estimate_id: string | null;
  project_id: string | null;
  meeting_id: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  visited_at: string;
  status: WalkthroughStatus;
  purpose: string | null;
  summary: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface WalkthroughNote {
  id: string;
  walkthrough_id: string;
  content: string;
  source: NoteSource;
  sort_order: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface WalkthroughFile {
  id: string;
  walkthrough_id: string;
  storage_path: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  caption: string | null;
  uploaded_by: string;
  created_at: string;
}

// ── Trade Rates / Cost Book ──────────────────────────────

export type UnitType = "sqft" | "linear_ft" | "each" | "lump_sum";

export interface TradeRate {
  id: string;
  trade_name: string;
  description: string | null;
  unit_type: UnitType;
  avg_cost: number;
  avg_price: number;
  min_cost: number | null;
  max_cost: number | null;
  sample_count: number;
  data_sources: string[];
  last_updated_from: string | null;
  notes: string | null;
  is_active: boolean;
  project_type: ProjectType | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// ── Meeting Questions ──────────────────────────────

export type QuestionCategory =
  | "dimensions"
  | "materials"
  | "fixtures"
  | "structural"
  | "scope"
  | "budget"
  | "timeline"
  | "general";

export interface MeetingQuestion {
  id: string;
  meeting_id: string;
  question: string;
  answer: string | null;
  category: QuestionCategory;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// ── Workflow Automation ──────────────────────────────────────

export type WorkflowStage =
  | "lead_intake"
  | "schedule_confirmation"
  | "walkthrough"
  | "estimating"
  | "owner_review"
  | "client_review"
  | "permit_deposit"
  | "job_package"
  | "pm_handoff"
  | "construction_started"
  | "rough_inspection"
  | "final_inspection"
  | "audit";

export type WorkflowStatus = "active" | "paused" | "completed" | "cancelled";

export type WorkflowActionType =
  | "stage_advanced"
  | "email_sent"
  | "folder_created"
  | "meeting_created"
  | "estimate_sent"
  | "client_approved"
  | "client_rejected"
  | "deposit_received"
  | "contract_sent"
  | "job_package_created"
  | "assigned_to_pm"
  | "note_added"
  | "schedule_confirmed"
  | "schedule_rescheduled"
  | "owner_approved"
  | "permit_requested"
  | "permit_pulled"
  | "inspection_passed";

export interface WorkflowInstance {
  id: string;
  lead_id: string | null;
  project_id: string | null;
  customer_id: string | null;
  estimate_id: string | null;
  current_stage: WorkflowStage;
  status: WorkflowStatus;
  project_name: string;
  client_name: string;
  client_email: string | null;
  client_phone: string | null;
  project_address: string | null;
  project_city: string | null;
  project_state: string | null;
  project_zip: string | null;
  project_type: string | null;
  project_description: string | null;
  google_drive_folder_id: string | null;
  google_drive_folder_url: string | null;
  google_calendar_event_id: string | null;
  google_sheet_id: string | null;
  google_sheet_url: string | null;
  assigned_estimator: string | null;
  assigned_pm: string | null;
  assigned_admin: string | null;
  estimate_amount: number | null;
  deposit_amount: number | null;
  contract_signed_at: string | null;
  deposit_received_at: string | null;
  walkthrough_date: string | null;
  walkthrough_id: string | null;
  lead_intake_at: string;
  schedule_confirmed_at: string | null;
  walkthrough_completed_at: string | null;
  estimate_sent_at: string | null;
  estimate_sheet_linked_at: string | null;
  owner_approved_at: string | null;
  client_approved_at: string | null;
  deposit_received_confirmed_at: string | null;
  permit_requested_at: string | null;
  permit_pulled_at: string | null;
  job_package_created_at: string | null;
  pm_handoff_at: string | null;
  assigned_to_pm_at: string | null;
  construction_started_at: string | null;
  rough_inspection_at: string | null;
  final_inspection_at: string | null;
  audit_at: string | null;
  completed_at: string | null;
  client_approval_token: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface WorkflowAction {
  id: string;
  workflow_id: string;
  action_type: WorkflowActionType;
  stage: WorkflowStage;
  description: string;
  metadata: Record<string, unknown>;
  performed_by: string | null;
  created_at: string;
}

export interface WorkflowEmailTemplate {
  id: string;
  stage: WorkflowStage;
  template_name: string;
  subject: string;
  body: string;
  recipient_type: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ── Command Center ──────────────────────────────────────

export type QuoteRequestStatus = "just_sent" | "awaiting_reply" | "received" | "in_progress" | "accepted" | "declined";

export interface QuoteRequest {
  id: string;
  project_id: string | null;
  subcontractor_id: string | null;
  subcontractor_name: string;
  project_name: string;
  trade: string | null;
  scope_description: string | null;
  amount: number | null;
  status: QuoteRequestStatus;
  sent_at: string;
  received_at: string | null;
  notes: string | null;
  gmail_message_id: string | null;
  attachment_storage_path: string | null;
  document_type: string;
  extracted_text: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type TodoStatus = "open" | "done" | "snoozed";
export type TodoPriority = "low" | "medium" | "high" | "urgent";

export interface Todo {
  id: string;
  project_id: string | null;
  project_name: string | null;
  contact_name: string;
  contact_type: string;
  description: string;
  status: TodoStatus;
  priority: TodoPriority;
  due_date: string | null;
  completed_at: string | null;
  gmail_draft_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type ClientUpdateStatus = "pending" | "sent" | "skipped";

export interface ClientUpdate {
  id: string;
  project_id: string | null;
  client_name: string;
  client_email: string | null;
  week_start: string;
  status: ClientUpdateStatus;
  sent_at: string | null;
  summary: string | null;
  gmail_message_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type EmailDirection = "inbound" | "outbound";
export type EmailCategory = "client_update" | "sub_outreach" | "internal" | "quote" | "follow_up" | "other";

export interface EmailLog {
  id: string;
  gmail_message_id: string | null;
  subject: string;
  from_email: string;
  to_email: string;
  direction: EmailDirection;
  category: EmailCategory;
  project_id: string | null;
  sent_at: string;
  created_at: string;
}

export type ProjectPhase =
  | "preconstruction"
  | "pre_start"
  | "rough_in"
  | "finishing"
  | "punch_list"
  | "complete";

export interface ProjectWithDetails extends Project {
  customer?: Customer | null;
  quote_count?: number;
  next_action?: string | null;
  progress?: number;
  subcontractor_names?: string[];
}
