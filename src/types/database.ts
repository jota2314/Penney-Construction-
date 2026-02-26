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
  notes: string | null;
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
  created_by: string;
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

// ── Site Visits ──────────────────────────────────────

export type SiteVisitStatus = "in_progress" | "completed";

export interface SiteVisit {
  id: string;
  project_id: string;
  visited_at: string;
  status: SiteVisitStatus;
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
