import type { LeadStatus, ReferralSource, LeadUrgency } from "@/types/database";

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  meeting_scheduled: "Meeting Scheduled",
  meeting_complete: "Meeting Complete",
  estimating: "Estimating",
  converted: "Converted",
  lost: "Lost",
};

export const LEAD_STATUS_COLORS: Record<LeadStatus, string> = {
  new: "bg-blue-100 text-blue-700",
  contacted: "bg-amber-100 text-amber-700",
  meeting_scheduled: "bg-purple-100 text-purple-700",
  meeting_complete: "bg-emerald-100 text-emerald-700",
  estimating: "bg-indigo-100 text-indigo-700",
  converted: "bg-green-100 text-green-700",
  lost: "bg-red-100 text-red-700",
};

export const ALL_LEAD_STATUSES: LeadStatus[] = [
  "new",
  "contacted",
  "meeting_scheduled",
  "meeting_complete",
  "estimating",
  "converted",
  "lost",
];

export const REFERRAL_SOURCE_LABELS: Record<ReferralSource, string> = {
  facebook: "Facebook",
  google: "Google",
  referral: "Referral",
  website: "Website",
  other: "Other",
};

export const ALL_REFERRAL_SOURCES: ReferralSource[] = [
  "facebook",
  "google",
  "referral",
  "website",
  "other",
];

export const URGENCY_LABELS: Record<LeadUrgency, string> = {
  asap: "ASAP",
  within_month: "Within a Month",
  within_3_months: "Within 3 Months",
  flexible: "Flexible",
  unknown: "Unknown",
};

export const ALL_URGENCIES: LeadUrgency[] = [
  "asap",
  "within_month",
  "within_3_months",
  "flexible",
  "unknown",
];
