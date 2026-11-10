"use server";

import { revalidatePath } from "next/cache";
import { getUser } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { canManageWebsiteInquiries, WEBSITE_INQUIRY_EMAILS, INTAKE_STATUSES, isHandedOffStatus, inquiryDueIso, inquiryText, summarizeInquiries, type Inquiry, type InquiryState, type IntakeStatus, type MatchingInquiryLead } from "@/lib/inquiries/model";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNS = "id,contact_name,description,created_at,updated_at,assignee,due_date,status,snooze_until,intake_status,lead_id,website_inquiry,project_id,project:projects(id,project_number,name,status)";
async function inquiryAccess(write = false) {
  const user = await getUser();
  if (!user || !canManageWebsiteInquiries(user.realProfile?.email) || !canManageWebsiteInquiries(user.profile?.email)) {
    throw new Error("Website inquiries are available only to Jorge, Ryan, Nico, and Shannon.");
  }
  if (write && user.isImpersonating) throw new Error("Exit View as before changing an inquiry.");
  return { user, db: await createClient() };
}
export async function listWebsiteInquiries(): Promise<Inquiry[]> {
  const { db } = await inquiryAccess();
  return fetchAllRows<Inquiry>((from, to) => db.from("todos").select(COLUMNS).eq("source", "website")
    .order("created_at", { ascending: false }).order("id").range(from, to).throwOnError());
}
export async function getWebsiteInquirySummary() {
  const { db } = await inquiryAccess();
  const rows = await fetchAllRows<InquiryState>((from, to) => db.from("todos")
    .select("status,intake_status,due_date,snooze_until").eq("source", "website")
    .order("id").range(from, to).throwOnError());
  return summarizeInquiries(rows);
}
export async function getWebsiteInquiry(id: string): Promise<Inquiry | null> {
  const { db } = await inquiryAccess();
  if (!UUID.test(id)) return null;
  const { data, error } = await db.from("todos").select(COLUMNS).eq("source", "website").eq("id", id).maybeSingle();
  if (error) throw new Error("The inquiry could not be loaded. Please refresh.");
  return data as Inquiry | null;
}
export async function listInquiryAssignees(): Promise<string[]> {
  const { db } = await inquiryAccess();
  const { data, error } = await db.from("profiles").select("full_name").in("email", [...WEBSITE_INQUIRY_EMAILS]);
  if (error) throw new Error("The office team could not be loaded. Please refresh.");
  return [...new Set((data || []).map((row) => (row.full_name as string | null)?.trim().split(/\s+/)[0]).filter((name): name is string => !!name))].sort();
}
export async function listMatchingInquiryLeads(id: string): Promise<MatchingInquiryLead[]> {
  const inquiry = await getWebsiteInquiry(id);
  if (!inquiry) return [];
  const email = inquiryText(inquiry, "email");
  if (!email) return [];
  const { db } = await inquiryAccess();
  // ilike is exact here: escape wildcard characters that are legal in an email.
  const pattern = email.replace(/[\\%_]/g, "\\$&");
  const { data, error } = await db.from("leads").select("id,first_name,last_name,city,project_type,status")
    .ilike("email", pattern).order("created_at", { ascending: false });
  if (error) throw new Error("Matching leads could not be loaded. Please refresh before converting.");
  return (data || []) as MatchingInquiryLead[];
}
function refreshInquiry(id: string) {
  revalidatePath("/command-center");
  revalidatePath("/command-center/inquiries");
  revalidatePath(`/command-center/inquiries/${id}`);
  revalidatePath("/command-center/todos");
}
export async function updateWebsiteInquiry(input: { id: string; expectedUpdatedAt: string; status: IntakeStatus; assignee: string; dueDay: string }) {
  try {
    const { db } = await inquiryAccess(true);
    if (!UUID.test(input.id) || !Number.isFinite(Date.parse(input.expectedUpdatedAt)) || !INTAKE_STATUSES.includes(input.status)) {
      return { error: "The inquiry or status is invalid. Refresh before trying again." };
    }
    const due = input.dueDay ? inquiryDueIso(input.dueDay) : null;
    if (input.dueDay && !due) return { error: "Choose a valid follow-up date." };
    if (!isHandedOffStatus(input.status) && !due) return { error: "Open inquiries need a next follow-up date." };
    const assignees = await listInquiryAssignees();
    if (!assignees.includes(input.assignee)) return { error: "Choose an office team member." };
    const { error } = await db.rpc("update_website_inquiry", {
      p_todo_id: input.id, p_expected_updated_at: input.expectedUpdatedAt,
      p_status: input.status, p_assignee: input.assignee, p_due_date: due,
    });
    if (error) return { error: error.message };
    refreshInquiry(input.id);
    return { error: null };
  } catch (error) { return { error: error instanceof Error ? error.message : "The inquiry could not be saved." }; }
}
export async function convertWebsiteInquiry(id: string, existingLeadId: string | null = null) {
  try {
    const { db } = await inquiryAccess(true);
    if (!UUID.test(id)) return { error: "The inquiry is invalid." };
    if (existingLeadId !== null && !UUID.test(existingLeadId)) return { error: "Choose a valid matching lead or create a new lead." };
    const { data, error } = await db.rpc("convert_website_inquiry_to_lead", { p_todo_id: id, p_existing_lead_id: existingLeadId });
    if (error) return { error: error.message };
    if (typeof data !== "string" || !UUID.test(data)) return { error: "The lead could not be confirmed. Refresh before trying again." };
    refreshInquiry(id);
    revalidatePath("/crm"); revalidatePath("/crm/leads");
    return { error: null, leadId: data };
  } catch (error) { return { error: error instanceof Error ? error.message : "The inquiry could not be converted." }; }
}

/**
 * Website inquiry -> customer + project in one step, through the same DB
 * function the Penney MCP tool and the stage job use
 * (create_project_from_website_inquiry). The function only runs for the
 * service role, so the inquiry-team check happens here first and the signed-in
 * person is passed as the actor. Repeating it links the existing project
 * instead of creating a second one.
 */
export async function createProjectFromWebsiteInquiry(id: string, status: "lead" | "estimating" = "lead") {
  try {
    const { user } = await inquiryAccess(true);
    if (!UUID.test(id)) return { error: "The inquiry is invalid." };
    if (status !== "lead" && status !== "estimating") return { error: "Choose Lead or Estimating." };
    const actorId = user.realProfile?.id ?? user.profile?.id ?? null;
    const { data, error } = await createAdminClient().rpc("create_project_from_website_inquiry", {
      p_todo_id: id, p_status: status, p_actor: actorId, p_update_stage: true,
    });
    if (error) return { error: error.message };
    const result = data as { project_id?: string; project_number?: string; created?: boolean } | null;
    if (!result?.project_id || !UUID.test(result.project_id)) return { error: "The project could not be confirmed. Refresh before trying again." };
    refreshInquiry(id);
    revalidatePath("/projects"); revalidatePath("/customers"); revalidatePath("/dashboard");
    return { error: null, projectId: result.project_id, projectNumber: result.project_number ?? "", created: result.created === true };
  } catch (error) { return { error: error instanceof Error ? error.message : "The project could not be created." }; }
}

export async function deleteWebsiteInquiry(input: { id: string; expectedUpdatedAt: string }): Promise<{ error: string | null }> {
  try {
    const { db } = await inquiryAccess(true);
    if (!input || !UUID.test(input.id) || typeof input.expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(input.expectedUpdatedAt))) {
      return { error: "The inquiry is invalid. Refresh before deleting." };
    }
    const { data, error } = await db.rpc("delete_website_inquiry", {
      p_todo_id: input.id, p_expected_updated_at: input.expectedUpdatedAt,
    });
    if (error) return { error: error.message };
    if (data?.deleted !== true || data?.id !== input.id) return { error: "Deletion could not be confirmed. Refresh before continuing." };
    refreshInquiry(input.id);
    return { error: null };
  } catch (error) { return { error: error instanceof Error ? error.message : "The inquiry could not be deleted." }; }
}
