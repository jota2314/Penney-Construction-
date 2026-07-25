"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  ensureDefaultPaymentSchedule,
  lockContractAndPremakeInvoices,
  type DB,
} from "@/lib/contracts/contract-lock";

async function requireCountersigner(supabase: DB) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" as const };

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", user.id)
    .single();

  // Countersigning binds the company to a price. Owners (Ryan, Shannon,
  // Nicole) and precon (Jorge) only — same gate as proposal approval.
  if (!profile || !["owner", "precon_manager"].includes(profile.role ?? "")) {
    return { error: "Only an owner or precon manager can countersign a contract" as const };
  }
  return { user, profile };
}

/**
 * Ryan's side of the signature. The client signs online at /contract/[token];
 * this is the countersignature that executes the contract and locks the money.
 */
export async function countersignContract(projectId: string, signature: string) {
  const supabase = await createClient();
  const auth = await requireCountersigner(supabase);
  if ("error" in auth) return { error: auth.error };

  const name = signature.trim();
  if (name.length < 2) return { error: "Type your full name to sign" };

  const { data: project, error: pErr } = await supabase
    .from("projects")
    .select("id, contract_client_signed_at, contract_countersigned_at, contract_locked_at")
    .eq("id", projectId)
    .single();
  if (pErr || !project) return { error: pErr?.message ?? "Project not found" };
  if (project.contract_countersigned_at) return { error: "This contract is already countersigned" };
  if (!project.contract_client_signed_at) {
    return { error: "The client has not signed yet — send them the contract first" };
  }

  const { error: signErr } = await supabase
    .from("projects")
    .update({
      contract_countersigned_by: auth.user.id,
      contract_countersigned_name: auth.profile.full_name ?? null,
      contract_countersigned_signature: name,
      contract_countersigned_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", projectId)
    .is("contract_countersigned_at", null);
  if (signErr) return { error: signErr.message };

  const result = await lockContractAndPremakeInvoices(supabase, projectId);
  if (result.error) return { error: result.error };

  revalidatePath(`/projects/${projectId}`);
  return { data: result.data };
}

/**
 * The jobs signed on paper before this flow existed — Caraglia, Sobol,
 * Gouthro, Ledgewood. Same lock, same premade invoices, no email round trip.
 * Without this they stay empty forever.
 */
export async function markContractSignedOnPaper(
  projectId: string,
  clientName: string,
  signedDate?: string,
) {
  const supabase = await createClient();
  const auth = await requireCountersigner(supabase);
  if ("error" in auth) return { error: auth.error };

  const name = clientName.trim();
  if (name.length < 2) return { error: "Enter the name of the client who signed" };

  const { data: project, error: pErr } = await supabase
    .from("projects")
    .select("id, contract_locked_at")
    .eq("id", projectId)
    .single();
  if (pErr || !project) return { error: pErr?.message ?? "Project not found" };
  if (project.contract_locked_at) return { error: "This contract is already locked" };

  const signedAt = signedDate ? new Date(signedDate).toISOString() : new Date().toISOString();

  const { error: signErr } = await supabase
    .from("projects")
    .update({
      contract_client_signature: name,
      contract_client_signed_at: signedAt,
      contract_client_ip: "signed on paper",
      contract_countersigned_by: auth.user.id,
      contract_countersigned_name: auth.profile.full_name ?? null,
      contract_countersigned_signature: auth.profile.full_name ?? "Penney Construction, Inc.",
      contract_countersigned_at: signedAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", projectId)
    .is("contract_locked_at", null);
  if (signErr) return { error: signErr.message };

  const result = await lockContractAndPremakeInvoices(supabase, projectId);
  if (result.error) return { error: result.error };

  revalidatePath(`/projects/${projectId}`);
  return { data: result.data };
}

/**
 * Undo a lock. Reprices the job back to the live estimate — used when a
 * contract was locked in error, or superseded before work started. Refuses
 * once any premade invoice has actually been sent or paid.
 */
export async function unlockContract(projectId: string) {
  const supabase = await createClient();
  const auth = await requireCountersigner(supabase);
  if ("error" in auth) return { error: auth.error };

  const { data: invoices } = await supabase
    .from("client_invoices")
    .select("id, status")
    .eq("project_id", projectId);
  const committed = (invoices ?? []).filter((i) => i.status !== "draft");
  if (committed.length > 0) {
    return {
      error: `${committed.length} invoice(s) on this contract have already been sent or paid — void those first.`,
    };
  }

  const { error } = await supabase
    .from("projects")
    .update({
      contract_locked_amount: null,
      contract_locked_at: null,
      contract_countersigned_by: null,
      contract_countersigned_name: null,
      contract_countersigned_signature: null,
      contract_countersigned_at: null,
      contract_status: "sent",
      updated_at: new Date().toISOString(),
    })
    .eq("id", projectId);
  if (error) return { error: error.message };

  revalidatePath(`/projects/${projectId}`);
  return { data: { unlocked: true } };
}

/** Seed the thirds schedule on demand from the Contract tile. */
export async function seedDefaultPaymentSchedule(projectId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { seeded, error } = await ensureDefaultPaymentSchedule(supabase, projectId);
  if (error) return { error };
  revalidatePath(`/projects/${projectId}`);
  return { data: { seeded } };
}
