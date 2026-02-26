"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ESTIMATE_TEMPLATES } from "@/lib/constants/estimate";
import type {
  LeadStatus,
  LeadUrgency,
  ProjectType,
  ReferralSource,
} from "@/types/database";

interface LeadInput {
  first_name: string;
  last_name: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  project_type?: ProjectType;
  description?: string;
  referral_source?: ReferralSource;
  referral_detail?: string;
  budget_min?: number;
  budget_max?: number;
  urgency?: LeadUrgency;
  timeline_notes?: string;
  status?: LeadStatus;
  lost_reason?: string;
}

export async function createLead(input: LeadInput) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { data, error } = await supabase
    .from("leads")
    .insert({
      first_name: input.first_name,
      last_name: input.last_name,
      phone: input.phone || null,
      email: input.email || null,
      address: input.address || null,
      city: input.city || null,
      state: input.state || null,
      zip: input.zip || null,
      project_type: input.project_type || null,
      description: input.description || null,
      referral_source: input.referral_source || null,
      referral_detail: input.referral_detail || null,
      budget_min: input.budget_min || null,
      budget_max: input.budget_max || null,
      urgency: input.urgency || "unknown",
      timeline_notes: input.timeline_notes || null,
      status: input.status || "new",
      lost_reason: input.lost_reason || null,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  revalidatePath("/crm");
  revalidatePath("/dashboard");
  return { error: null, id: data.id };
}

export async function updateLead(id: string, input: LeadInput) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("leads")
    .update({
      first_name: input.first_name,
      last_name: input.last_name,
      phone: input.phone || null,
      email: input.email || null,
      address: input.address || null,
      city: input.city || null,
      state: input.state || null,
      zip: input.zip || null,
      project_type: input.project_type || null,
      description: input.description || null,
      referral_source: input.referral_source || null,
      referral_detail: input.referral_detail || null,
      budget_min: input.budget_min || null,
      budget_max: input.budget_max || null,
      urgency: input.urgency || "unknown",
      timeline_notes: input.timeline_notes || null,
      status: input.status || "new",
      lost_reason: input.lost_reason || null,
    })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/crm");
  revalidatePath(`/crm/leads/${id}`);
  revalidatePath("/dashboard");
  return { error: null };
}

export async function deleteLead(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase.from("leads").delete().eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/crm");
  revalidatePath("/dashboard");
  return { error: null };
}

export async function createEstimateFromLead(leadId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  // 1. Fetch the lead
  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .single();

  if (leadError || !lead) return { error: "Lead not found" };

  if (lead.estimate_id) return { error: "Lead already has an estimate" };
  if (lead.status === "converted") return { error: "Lead already converted" };

  // 2. Auto-increment version for this lead
  const { data: existing } = await supabase
    .from("estimates")
    .select("version")
    .eq("lead_id", leadId)
    .is("project_id", null)
    .order("version", { ascending: false })
    .limit(1);

  const nextVersion = existing && existing.length > 0 ? existing[0].version + 1 : 1;

  // 3. Create the estimate
  const estimateName = `${lead.first_name} ${lead.last_name} - ${lead.project_type || "Estimate"} v${nextVersion}`;

  const { data: estimate, error: estError } = await supabase
    .from("estimates")
    .insert({
      lead_id: leadId,
      project_id: null,
      version: nextVersion,
      name: estimateName,
      status: "draft",
      description: lead.description || null,
      markup_percentage: 0,
      notes: null,
      total_cost: 0,
      total_price: 0,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (estError) return { error: estError.message };

  // 4. Pre-populate from template if project_type matches
  const templateKey = lead.project_type || "";
  const templateItems = ESTIMATE_TEMPLATES[templateKey];
  if (templateItems && templateItems.length > 0) {
    const rows = templateItems.map((name, index) => ({
      estimate_id: estimate.id,
      description: name,
      proposal_description: null,
      quantity: 1,
      unit: "LS",
      unit_cost: 0,
      total_cost: 0,
      markup_percentage: 0,
      total_price: 0,
      is_visible_on_proposal: true,
      notes: null,
      sort_order: index,
    }));
    await supabase.from("estimate_line_items").insert(rows);
  }

  // 5. Update lead status to "estimating" and set estimate_id
  await supabase
    .from("leads")
    .update({
      status: "estimating",
      estimate_id: estimate.id,
    })
    .eq("id", leadId);

  revalidatePath("/crm");
  revalidatePath(`/crm/leads/${leadId}`);
  revalidatePath("/estimates");
  revalidatePath("/dashboard");
  return { error: null, estimateId: estimate.id };
}

export async function convertLeadToProject(leadId: string, estimateId?: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  // 1. Fetch the lead
  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .single();

  if (leadError || !lead) return { error: "Lead not found" };

  if (lead.status === "converted") {
    return { error: "Lead already converted" };
  }

  // 2. Find or create customer
  let customerId: string | null = null;

  // Check for existing customer by name
  const { data: existing } = await supabase
    .from("customers")
    .select("id")
    .eq("first_name", lead.first_name)
    .eq("last_name", lead.last_name)
    .limit(1);

  if (existing && existing.length > 0) {
    customerId = existing[0].id;
  } else {
    const { data: newCustomer, error: custError } = await supabase
      .from("customers")
      .insert({
        first_name: lead.first_name,
        last_name: lead.last_name,
        email: lead.email,
        phone: lead.phone,
        address: lead.address,
        city: lead.city,
        state: lead.state,
        zip: lead.zip,
        created_by: user.id,
      })
      .select("id")
      .single();

    if (custError) return { error: custError.message };
    customerId = newCustomer.id;
  }

  // 3. Create project
  const projectName = `${lead.first_name} ${lead.last_name} - ${lead.project_type || "Project"}`;

  const { data: newProject, error: projError } = await supabase
    .from("projects")
    .insert({
      name: projectName,
      customer_id: customerId,
      status: "estimating",
      project_type: lead.project_type || "other",
      description: lead.description,
      address: lead.address,
      city: lead.city,
      state: lead.state,
      zip: lead.zip,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (projError) return { error: projError.message };

  // 4. Link the estimate to the new project (if provided or from lead)
  const estId = estimateId || lead.estimate_id;
  if (estId) {
    await supabase
      .from("estimates")
      .update({ project_id: newProject.id })
      .eq("id", estId);
  }

  // 5. Update lead as converted
  const { error: updateError } = await supabase
    .from("leads")
    .update({
      status: "converted",
      customer_id: customerId,
      project_id: newProject.id,
    })
    .eq("id", leadId);

  if (updateError) return { error: updateError.message };

  revalidatePath("/crm");
  revalidatePath("/projects");
  revalidatePath("/customers");
  revalidatePath("/estimates");
  revalidatePath("/dashboard");
  return { error: null, projectId: newProject.id };
}
