"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { aliasProblem, loadSubDirectory, type SubDirectoryEntry } from "@/lib/schedule/suggest-subs";

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
  /** "Also called": names the notes use for this sub ("Marcio"). Left out = unchanged. */
  aliases?: string[];
}

/** Trimmed, de-duplicated (ignoring case), 3–40 characters each (shorter never matches notes), at most 10. */
function cleanAliases(raw: string[] | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const out: string[] = [];
  for (const a of raw) {
    const v = String(a ?? "").replace(/\s+/g, " ").trim();
    if (v.length < 3 || v.length > 40) continue;
    if (out.some((x) => x.toLowerCase() === v.toLowerCase())) continue;
    out.push(v);
  }
  return out.slice(0, 10);
}

/**
 * Null when every NEW alias may be saved, else the first reason one can't
 * (shown in the form). The same check as saveSubAlias: a first name another
 * active sub's contact also has, another sub's alias, or a trade or common
 * word ("Tile") is refused, because an alias makes a name a sure match for
 * this one sub. Aliases already saved on the row aren't re-checked, so an
 * unrelated edit is never blocked.
 */
async function aliasError(
  supabase: Awaited<ReturnType<typeof createClient>>,
  self: SubDirectoryEntry,
  raw: string[] | undefined,
  alreadySaved: string[],
): Promise<string | null> {
  if (!raw?.length) return null;
  const have = new Set(alreadySaved.map((a) => a.trim().toLowerCase()));
  const seen = new Set<string>();
  const fresh: string[] = [];
  for (const a of raw) {
    const v = String(a ?? "").replace(/\s+/g, " ").trim();
    const key = v.toLowerCase();
    if (!v || seen.has(key)) continue;
    seen.add(key);
    if (!have.has(key)) fresh.push(v);
  }
  if (seen.size > 10) return "Keep \"Also called\" to 10 names or fewer.";
  if (!fresh.length) return null;
  const directory = await loadSubDirectory(supabase);
  for (const a of fresh) {
    const problem = aliasProblem(a, self, directory.values());
    if (problem) return problem;
  }
  return null;
}

export async function createSubcontractor(input: SubcontractorInput) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const problem = await aliasError(
    supabase,
    { id: "", company_name: input.company_name, contact_name: input.contact_name || null, trades: input.trades, aliases: [] },
    input.aliases,
    [],
  );
  if (problem) return { error: problem };

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
    ...(input.aliases !== undefined ? { aliases: cleanAliases(input.aliases) } : {}),
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

  if (input.aliases !== undefined) {
    const { data: row } = await supabase
      .from("subcontractors")
      .select("id, company_name, contact_name, trades, aliases")
      .eq("id", id)
      .maybeSingle();
    const current = (row ?? null) as SubDirectoryEntry | null;
    const problem = await aliasError(
      supabase,
      { id, company_name: input.company_name, contact_name: input.contact_name || null, trades: input.trades, aliases: current?.aliases ?? [] },
      input.aliases,
      current?.aliases ?? [],
    );
    if (problem) return { error: problem };
  }

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
      ...(input.aliases !== undefined ? { aliases: cleanAliases(input.aliases) } : {}),
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
      // An amount makes it his contract: a 'visit_only' link from a QR
      // check-in (or a voided-back 'removed' one) becomes 'active', so Weekly
      // Close and his job list see it. A $0 save leaves the status alone; a
      // new row still gets the column default 'active'.
      ...(contractAmount > 0 ? { status: "active" as const } : {}),
    },
    { onConflict: "project_id,subcontractor_id" }
  );

  if (error) {
    // A signed work order freezes this amount (guard_locked_sub_contract):
    // say which one and point at a sub change order instead of a raw error.
    // Imported here so this fix stays inside this function.
    const { subContractLockedMessage } = await import("@/lib/sub-portal/statuses");
    return { error: subContractLockedMessage(error) ?? error.message };
  }

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
