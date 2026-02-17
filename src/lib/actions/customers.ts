"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

interface CustomerInput {
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  notes?: string;
}

export async function createCustomer(input: CustomerInput) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase.from("customers").insert({
    first_name: input.first_name,
    last_name: input.last_name,
    email: input.email || null,
    phone: input.phone || null,
    address: input.address || null,
    city: input.city || null,
    state: input.state || null,
    zip: input.zip || null,
    notes: input.notes || null,
    created_by: user.id,
  });

  if (error) return { error: error.message };

  revalidatePath("/customers");
  return { error: null };
}

export async function updateCustomer(id: string, input: CustomerInput) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("customers")
    .update({
      first_name: input.first_name,
      last_name: input.last_name,
      email: input.email || null,
      phone: input.phone || null,
      address: input.address || null,
      city: input.city || null,
      state: input.state || null,
      zip: input.zip || null,
      notes: input.notes || null,
    })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/customers");
  return { error: null };
}

export async function deleteCustomer(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  // Check for linked projects
  const { count } = await supabase
    .from("projects")
    .select("*", { count: "exact", head: true })
    .eq("customer_id", id);

  if (count && count > 0) {
    return {
      error: `Cannot delete: ${count} project(s) linked to this customer. Remove the project links first.`,
    };
  }

  const { error } = await supabase.from("customers").delete().eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/customers");
  return { error: null };
}
