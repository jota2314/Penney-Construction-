import type { BillScan } from "@/lib/bills/types";

/** Shapes shared by the crew receipt scanner's routes and its screen. */

/** The crew read is a BillScan plus the receipt-only fields. */
export type CrewScan = BillScan & {
  time?: string | null;
  quoteReason?: string | null;
  confidence?: number;
  chargedToAccount?: boolean;
};

export type CrewRead = { scan: CrewScan; suggestedProjectId: string | null };

/** Where the job on a read came from — shown to the crew so a guess looks like one. */
export type CrewJobSource = "picked" | "receipt" | "fuel" | "timecard";

export type CrewJobHint = { id: string; label: string; reason: string };

export type CrewBudgetLine = {
  id: string;
  description: string;
  trade: string | null;
  section: string | null;
  isChangeOrder: boolean;
};

export type CrewAllocation = {
  lineItemId: string;
  lineLabel: string;
  trade: string | null;
  amount: number;
  note: string | null;
};

export type AllocationStatus = "pending" | "complete" | "failed" | "not_required";

export type CrewReadResponse = {
  status: "scanned" | "needs_job";
  scan: CrewScan;
  job: { id: string; label: string } | null;
  jobSource: CrewJobSource | null;
  jobReason: string | null;
  suggestedJobs: CrewJobHint[];
  allocationStatus: AllocationStatus;
};

export type CrewAllocateResponse = {
  job: { id: string; label: string };
  allocations: CrewAllocation[];
  budgetLines: CrewBudgetLine[];
  allocationStatus: AllocationStatus;
  allocationError?: string;
};

export type CrewFiled = {
  status: "filed";
  vendor: string;
  amount: number | null;
  project: string;
  splitCount: number;
  needsReview: boolean;
  reviewReason: string | null;
  alreadyFiled?: boolean;
};

export type CrewDocumented = {
  status: "document";
  vendor: string;
  project: string;
  kind?: "quote";
  note?: string | null;
  alreadyFiled?: boolean;
};
