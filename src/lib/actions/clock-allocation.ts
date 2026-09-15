"use server";
import { getUser } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";
import { canViewPayroll } from "@/lib/auth/role-access";
import { isFieldTask } from "@/lib/crew/clock-task-policy";
import { revalidatePath } from "next/cache";

async function applyClockAllocation(form: FormData): Promise<void> {
  const user = await getUser();
  if (!user || user.isImpersonating || !canViewPayroll(user.profile?.role)) throw new Error("Office access required.");
  const id = String(form.get("id") ?? "");
  const lineId = String(form.get("lineId") ?? "");
  const version = String(form.get("version") ?? "");
  const reason = String(form.get("reason") ?? "").trim();
  if (reason.length < 5 || reason.length > 1000) throw new Error("Add a reason for the allocation (5–1000 characters).");
  const db = await createClient();
  const { data: log, error: readError } = await db.from("daily_logs").select("id,project_id,line_item_note,estimate_line_item_id,status").eq("id",id).single();
  if (readError || !log || log.status !== "completed") throw new Error("Only completed time can be resolved here.");
  const { data: line } = await db.from("estimate_line_items").select("id,description,is_locked,is_section_header,estimate:estimates!estimate_id(project_id)").eq("id",lineId).single();
  const estimate = Array.isArray(line?.estimate) ? line.estimate[0] : line?.estimate;
  if (!line || line.is_locked || line.is_section_header || !isFieldTask(line.description) || estimate?.project_id !== log.project_id) throw new Error("Choose an open field task on this job.");
  const note = [log.line_item_note, `Office allocation ${new Date().toISOString()} by ${user.profile?.id ?? user.id}: ${log.estimate_line_item_id ?? "unassigned"} → ${lineId}. ${reason}`].filter(Boolean).join("\n");
  const { data: saved, error } = await db.from("daily_logs").update({estimate_line_item_id:lineId,line_item_source:"manual",line_item_needs_review:false,line_item_note:note})
    .eq("id",id).eq("updated_at",version).select("id").maybeSingle();
  if (error || !saved) throw new Error("Entry changed or could not be saved. Refresh and review it again.");
  revalidatePath("/week/crew-allocation"); revalidatePath("/week"); revalidatePath(`/projects/${log.project_id}`); revalidatePath("/command-center");
}

export async function resolveClockAllocation(form: FormData): Promise<{ok?: true; error?: string}> {
  try { await applyClockAllocation(form); return {ok:true}; }
  catch(error) { return {error:error instanceof Error ? error.message : "Allocation could not be saved. Refresh and try again."}; }
}
