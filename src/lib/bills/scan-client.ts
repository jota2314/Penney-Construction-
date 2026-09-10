import type { BillScanResult } from "./types";

// The browser starts allocation only after the server confirms the read was
// saved. A lost allocation response cannot erase that first response.
export async function scanBill(body: FormData, onRead?: (read: BillScanResult) => void): Promise<BillScanResult> {
  const response = await fetch("/api/bills/scan", { method: "POST", body });
  const read = await response.json();
  if (!response.ok) throw new Error(read?.error || "Could not read that file.");
  onRead?.(read);
  if (read.allocationStatus !== "pending" || !read.job) return read;
  return allocateBill(read, body.has("amount") ? Number(body.get("amount")) : undefined);
}

export async function allocateBill(read: BillScanResult, amount?: number, projectId?: string): Promise<BillScanResult> {
  try {
    const response = await fetch("/api/bills/allocate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storagePath: read.scan.storagePath, projectId: projectId ?? read.job?.id, amount }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result?.error || "Could not divide the invoice.");
    return result;
  } catch {
    return { ...read, allocationStatus: "failed",
      allocationError: "The invoice is read and saved. Dividing it did not finish; retry below. Nothing has been filed." };
  }
}
