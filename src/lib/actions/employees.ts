"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

interface EmployeeInput {
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  title?: string;
  status?: string;
  hourly_rate?: number;
  hire_date?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  notes?: string;
}

export async function createEmployee(input: EmployeeInput) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase.from("employees").insert({
    first_name: input.first_name,
    last_name: input.last_name,
    email: input.email || null,
    phone: input.phone || null,
    title: input.title || null,
    status: input.status || "active",
    hourly_rate: input.hourly_rate ?? null,
    hire_date: input.hire_date || null,
    emergency_contact_name: input.emergency_contact_name || null,
    emergency_contact_phone: input.emergency_contact_phone || null,
    notes: input.notes || null,
    created_by: user.id,
  });

  if (error) return { error: error.message };

  revalidatePath("/employees");
  return { error: null };
}

export async function updateEmployee(id: string, input: EmployeeInput) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("employees")
    .update({
      first_name: input.first_name,
      last_name: input.last_name,
      email: input.email || null,
      phone: input.phone || null,
      title: input.title || null,
      status: input.status || "active",
      hourly_rate: input.hourly_rate ?? null,
      hire_date: input.hire_date || null,
      emergency_contact_name: input.emergency_contact_name || null,
      emergency_contact_phone: input.emergency_contact_phone || null,
      notes: input.notes || null,
    })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/employees");
  return { error: null };
}

export async function deleteEmployee(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase.from("employees").delete().eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/employees");
  return { error: null };
}
