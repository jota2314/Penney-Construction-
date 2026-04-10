"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { BidPackageStatus, SubBidStatus } from "@/types/database";

// ── Queries ──────────────────────────────

export async function getBidPackages(projectId?: string) {
  const supabase = await createClient();
  let query = supabase
    .from("bid_packages")
    .select(`
      *,
      subcontractor_bids (
        id, subcontractor_id, amount, status, is_selected, submitted_at, sent_at, resent_count,
        subcontractors ( id, company_name, contact_name, email, phone, trades )
      ),
      projects ( id, name, project_number, address )
    `)
    .order("created_at", { ascending: false });

  if (projectId) {
    query = query.eq("project_id", projectId);
  }

  const { data, error } = await query;
  if (error) { console.error("getBidPackages error:", error); return []; }
  return data;
}

export async function getBidPackage(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bid_packages")
    .select(`
      *,
      subcontractor_bids (
        *,
        subcontractors ( id, company_name, contact_name, email, phone, trades, vetting_status )
      ),
      projects ( id, name, project_number, address, city, state ),
      estimate_line_items ( id, description, quantity, unit, unit_cost, total_cost )
    `)
    .eq("id", id)
    .single();

  if (error) { console.error("getBidPackage error:", error); return null; }
  return data;
}

export async function getBidEmailTemplate(trade?: string) {
  const supabase = await createClient();
  // Try trade-specific first, fallback to default
  if (trade) {
    const { data } = await supabase
      .from("bid_email_templates")
      .select("*")
      .eq("trade", trade)
      .eq("is_default", true)
      .single();
    if (data) return data;
  }
  const { data } = await supabase
    .from("bid_email_templates")
    .select("*")
    .eq("is_default", true)
    .is("trade", null)
    .single();
  return data;
}

// ── Create & Update ──────────────────────────────

interface CreateBidPackageInput {
  project_id: string;
  name: string;
  trade: string;
  scope_of_work?: string;
  due_date?: string;
  project_address?: string;
  estimate_line_item_id?: string;
  subcontractor_ids: string[];
}

export async function createBidPackage(input: CreateBidPackageInput) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated", id: null };

  // Create the bid package
  const { data: pkg, error: pkgError } = await supabase
    .from("bid_packages")
    .insert({
      project_id: input.project_id,
      name: input.name,
      trade: input.trade,
      scope_of_work: input.scope_of_work || null,
      due_date: input.due_date || null,
      project_address: input.project_address || null,
      estimate_line_item_id: input.estimate_line_item_id || null,
      status: "draft",
      created_by: user.id,
    })
    .select("id")
    .single();

  if (pkgError) return { error: pkgError.message, id: null };

  // Create subcontractor_bids rows for each invited sub
  if (input.subcontractor_ids.length > 0) {
    const bids = input.subcontractor_ids.map((subId) => ({
      bid_package_id: pkg.id,
      subcontractor_id: subId,
      status: "invited" as const,
    }));
    const { error: bidError } = await supabase.from("subcontractor_bids").insert(bids);
    if (bidError) return { error: bidError.message, id: pkg.id };
  }

  revalidatePath("/bids");
  return { error: null, id: pkg.id };
}

export async function updateBidPackageStatus(id: string, status: BidPackageStatus) {
  const supabase = await createClient();
  const update: Record<string, unknown> = { status };
  if (status === "sent") update.sent_at = new Date().toISOString();

  const { error } = await supabase.from("bid_packages").update(update).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/bids");
  revalidatePath(`/bids/${id}`);
  return { error: null };
}

export async function updateSubBidStatus(id: string, status: SubBidStatus, amount?: number) {
  const supabase = await createClient();
  const update: Record<string, unknown> = { status };
  if (amount !== undefined) update.amount = amount;
  if (status === "submitted") update.submitted_at = new Date().toISOString();

  const { error } = await supabase.from("subcontractor_bids").update(update).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/bids");
  return { error: null };
}

export async function markBidSent(bidId: string, gmailMessageId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("subcontractor_bids")
    .update({ gmail_message_id: gmailMessageId, sent_at: new Date().toISOString() })
    .eq("id", bidId);
  if (error) return { error: error.message };
  return { error: null };
}

export async function markBidResent(bidId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("increment_resent_count", { bid_id: bidId });
  // Fallback if RPC doesn't exist
  if (error) {
    await supabase
      .from("subcontractor_bids")
      .update({ last_resent_at: new Date().toISOString(), resent_count: 1 })
      .eq("id", bidId);
  }
  return { error: null };
}

// ── Award ──────────────────────────────

export async function awardBid(bidId: string, bidPackageId: string) {
  const supabase = await createClient();

  // Get the bid details
  const { data: bid } = await supabase
    .from("subcontractor_bids")
    .select("subcontractor_id, amount, bid_package_id")
    .eq("id", bidId)
    .single();
  if (!bid) return { error: "Bid not found" };

  // Get the project from the bid package
  const { data: pkg } = await supabase
    .from("bid_packages")
    .select("project_id")
    .eq("id", bidPackageId)
    .single();
  if (!pkg) return { error: "Bid package not found" };

  // Mark this bid as selected
  const { error: selectError } = await supabase
    .from("subcontractor_bids")
    .update({ is_selected: true, status: "accepted" })
    .eq("id", bidId);
  if (selectError) return { error: selectError.message };

  // Mark other bids in this package as rejected
  await supabase
    .from("subcontractor_bids")
    .update({ status: "rejected" })
    .eq("bid_package_id", bidPackageId)
    .neq("id", bidId)
    .in("status", ["invited", "submitted"]);

  // Update bid package status to awarded
  await supabase
    .from("bid_packages")
    .update({ status: "awarded" })
    .eq("id", bidPackageId);

  // Upsert project_subcontractors with contract amount
  if (bid.amount) {
    await supabase.from("project_subcontractors").upsert(
      {
        project_id: pkg.project_id,
        subcontractor_id: bid.subcontractor_id,
        contract_amount: bid.amount,
      },
      { onConflict: "project_id,subcontractor_id" }
    );
  }

  revalidatePath("/bids");
  revalidatePath(`/bids/${bidPackageId}`);
  return { error: null };
}

// ── Delete ──────────────────────────────

export async function deleteBidPackage(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("bid_packages").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/bids");
  return { error: null };
}

// ── Bid Stats (for Command Center) ──────────────────────────────

export async function getBidStats() {
  const supabase = await createClient();

  const { data: packages } = await supabase
    .from("bid_packages")
    .select("id, status")
    .in("status", ["sent", "receiving"]);

  const { data: bids } = await supabase
    .from("subcontractor_bids")
    .select("id, status")
    .eq("status", "invited");

  const { data: needsAward } = await supabase
    .from("bid_packages")
    .select("id")
    .eq("status", "receiving");

  return {
    activeBidPackages: packages?.length ?? 0,
    awaitingResponse: bids?.length ?? 0,
    needsAward: needsAward?.length ?? 0,
  };
}
