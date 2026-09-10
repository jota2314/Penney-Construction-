export type BillAllocation = {
  lineItemId: string;
  lineLabel: string;
  trade: string | null;
  amount: number;
  note: string | null;
};

export type BillScan = {
  storagePath: string;
  documentType: string;
  filename: string | null;
  vendor: string;
  amount: number | null;
  invoiceNumber: string | null;
  date: string | null;
  dueDate: string | null;
  trade: string | null;
  summary: string | null;
  items: Array<{ description: string; amount: number | null; trade: string | null }>;
  extractedText: string | null;
  jobHint?: string | null;
  lowConfidence?: boolean;
  jobGuessed?: boolean;
  alreadyPaid?: boolean;
  isCredit?: boolean;
  creditReason?: string | null;
  fuelAutoRouted?: boolean;
};

export type BillRead = { scan: BillScan; suggestedProjectId: string | null };
export type BillScanResult = {
  status: "scanned" | "needs_job";
  scan: BillScan;
  job: { id: string; label: string } | null;
  allocations: BillAllocation[];
  budgetLines: Array<{ id: string; description: string; trade: string | null }>;
  allocationStatus: "pending" | "complete" | "failed" | "not_required";
  allocationError?: string;
};
