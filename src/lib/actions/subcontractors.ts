"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

import type { VettingStatus } from "@/types/database";

interface SubcontractorInput {
  company_name: string;
  contact_name?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  trades: string[];
  license_number?: string;
  insurance_expiry?: string;
  rating?: number;
  notes?: string;
  is_active?: boolean;
  vetting_status?: VettingStatus;
}

export async function createSubcontractor(input: SubcontractorInput) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase.from("subcontractors").insert({
    company_name: input.company_name,
    contact_name: input.contact_name || null,
    email: input.email || null,
    phone: input.phone || null,
    address: input.address || null,
    city: input.city || null,
    state: input.state || null,
    zip: input.zip || null,
    trades: input.trades,
    license_number: input.license_number || null,
    insurance_expiry: input.insurance_expiry || null,
    rating: input.rating ?? null,
    notes: input.notes || null,
    is_active: input.is_active ?? true,
    vetting_status: input.vetting_status ?? "prospect",
    created_by: user.id,
  });

  if (error) return { error: error.message };

  revalidatePath("/subcontractors");
  return { error: null };
}

export async function updateSubcontractor(
  id: string,
  input: SubcontractorInput
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("subcontractors")
    .update({
      company_name: input.company_name,
      contact_name: input.contact_name || null,
      email: input.email || null,
      phone: input.phone || null,
      address: input.address || null,
      city: input.city || null,
      state: input.state || null,
      zip: input.zip || null,
      trades: input.trades,
      license_number: input.license_number || null,
      insurance_expiry: input.insurance_expiry || null,
      rating: input.rating ?? null,
      notes: input.notes || null,
      is_active: input.is_active ?? true,
      vetting_status: input.vetting_status ?? "prospect",
    })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/subcontractors");
  return { error: null };
}

export async function updateVettingStatus(id: string, status: VettingStatus) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("subcontractors")
    .update({ vetting_status: status })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/subcontractors");
  return { error: null };
}

export async function upsertContractAmount(
  projectId: string,
  subcontractorId: string,
  contractAmount: number
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase.from("project_subcontractors").upsert(
    {
      project_id: projectId,
      subcontractor_id: subcontractorId,
      contract_amount: contractAmount,
    },
    { onConflict: "project_id,subcontractor_id" }
  );

  if (error) return { error: error.message };

  revalidatePath("/subcontractors");
  return { error: null };
}

export async function deleteSubcontractor(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  // Check for linked bids
  const { count } = await supabase
    .from("subcontractor_bids")
    .select("*", { count: "exact", head: true })
    .eq("subcontractor_id", id);

  if (count && count > 0) {
    return {
      error: `Cannot delete: ${count} bid(s) linked to this subcontractor. Remove the bids first.`,
    };
  }

  const { error } = await supabase
    .from("subcontractors")
    .delete()
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/subcontractors");
  return { error: null };
}
