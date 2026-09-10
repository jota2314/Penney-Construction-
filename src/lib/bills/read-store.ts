import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { BillRead, BillScanResult } from "./types";

// Callers obtain owner from getUser(), never from request input. The table
// accepts no browser writes, so a forged request cannot poison a saved read.
export function ownsBillUpload(owner: string, path: string): boolean {
  return path.startsWith(`${owner}/`) && path.split("/").length === 2 &&
    !path.includes("..") && !path.includes("\\") && path.length > owner.length + 1;
}

export async function loadBillRead(owner: string, path: string): Promise<BillRead | null> {
  if (!ownsBillUpload(owner, path)) throw new Error("Not your upload");
  const { data, error } = await createAdminClient().from("bill_scan_reads")
    .select("result").eq("owner_id", owner).eq("storage_path", path).maybeSingle();
  if (error) throw new Error("Could not retrieve the saved read. Your file is safe; please retry.");
  return (data?.result as BillRead | undefined) ?? null;
}

export async function saveBillRead(owner: string, result: BillRead): Promise<BillRead> {
  const path = result.scan.storagePath;
  if (!ownsBillUpload(owner, path)) throw new Error("Not your upload");
  // First completed read wins, including concurrent retries. Allocation never
  // overwrites this immutable checkpoint or inserts financial records.
  const { error } = await createAdminClient().from("bill_scan_reads").upsert({
    owner_id: owner, storage_path: path, result,
  }, { onConflict: "storage_path", ignoreDuplicates: true });
  if (error) throw new Error("The file is saved, but its read could not be saved. Please retry.");
  const saved = await loadBillRead(owner, path);
  if (!saved) throw new Error("Could not verify the saved read. Please retry.");
  return saved;
}

export async function billReadResponse(read: BillRead, projectId?: string | null): Promise<BillScanResult> {
  const supabase = await createClient();
  const id = projectId || read.suggestedProjectId;
  let job: BillScanResult["job"] = null;
  if (id) {
    const { data, error } = await supabase.from("projects")
      .select("id, name, project_number").eq("id", id).maybeSingle();
    if (error) throw new Error("The invoice read is saved. Could not load the job; please retry.");
    if (data) job = { id: data.id, label: data.project_number ? `${data.project_number} ${data.name}` : data.name };
  }
  const scan = { ...read.scan, jobGuessed: !projectId && Boolean(job),
    fuelAutoRouted: id === read.suggestedProjectId && read.scan.fuelAutoRouted };
  const needsAllocation = job && scan.amount !== null &&
    !["quote", "delivery_ticket"].includes(scan.documentType);
  return { status: job ? "scanned" : "needs_job", scan, job, allocations: [], budgetLines: [],
    allocationStatus: needsAllocation ? "pending" : "not_required" };
}
