"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ProjectStatus, ProjectType } from "@/types/database";

interface ProjectInput {
  name: string;
  customer_id?: string;
  status: ProjectStatus;
  project_type: ProjectType;
  description?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  estimated_start_date?: string;
  estimated_end_date?: string;
  estimated_value?: number;
  contract_value?: number;
  assigned_pm?: string;
  assigned_estimator?: string;
  notes?: string;
}

export async function createProject(input: ProjectInput) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase.from("projects").insert({
    name: input.name,
    customer_id: input.customer_id || null,
    status: input.status,
    project_type: input.project_type,
    description: input.description || null,
    address: input.address || null,
    city: input.city || null,
    state: input.state || null,
    zip: input.zip || null,
    estimated_start_date: input.estimated_start_date || null,
    estimated_end_date: input.estimated_end_date || null,
    estimated_value: input.estimated_value || null,
    contract_value: input.contract_value || null,
    assigned_pm: input.assigned_pm || null,
    assigned_estimator: input.assigned_estimator || null,
    notes: input.notes || null,
    created_by: user.id,
  });

  if (error) return { error: error.message };

  revalidatePath("/projects");
  revalidatePath("/dashboard");
  return { error: null };
}

export async function updateProject(id: string, input: ProjectInput) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("projects")
    .update({
      name: input.name,
      customer_id: input.customer_id || null,
      status: input.status,
      project_type: input.project_type,
      description: input.description || null,
      address: input.address || null,
      city: input.city || null,
      state: input.state || null,
      zip: input.zip || null,
      estimated_start_date: input.estimated_start_date || null,
      estimated_end_date: input.estimated_end_date || null,
      estimated_value: input.estimated_value || null,
      contract_value: input.contract_value || null,
      assigned_pm: input.assigned_pm || null,
      assigned_estimator: input.assigned_estimator || null,
      notes: input.notes || null,
    })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/projects");
  revalidatePath(`/projects/${id}`);
  revalidatePath("/dashboard");
  return { error: null };
}

export async function updateProjectDescription(id: string, description: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("projects")
    .update({ description: description || null })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath(`/projects/${id}`);
  return { error: null };
}

export async function deleteProject(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase.from("projects").delete().eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/projects");
  revalidatePath("/dashboard");
  return { error: null };
}

export async function getTeamMembers() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, role")
    .order("full_name");

  if (error) return [];
  return data;
}
