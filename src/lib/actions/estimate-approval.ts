"use server";

import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/google/gmail";
import { revalidatePath } from "next/cache";

// Ryan is the approver. Hardcoded for now — if we add other owners later
// we swap this for a role check on profiles.
const APPROVER_EMAIL = "rpenney@penneyconstructioninc.com";

interface EstimateForEmail {
  id: string;
  name: string | null;
  total_price: number | string | null;
  project_id: string | null;
}

interface ProjectForEmail {
  name: string;
  project_number: string | null;
}

function formatMoney(v: number | string | null | undefined): string {
  if (v == null) return "$0";
  const n = typeof v === "number" ? v : Number(v) || 0;
  return "$" + n.toLocaleString();
}

function appOrigin(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://penney-construction-mf6m.vercel.app";
}

// Jorge → Ryan: send for review
export async function submitEstimateForReview(
  estimateId: string,
  note?: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated" };

  // Load estimate + project for the email body
  const { data: estimate, error: estErr } = await supabase
    .from("estimates")
    .select("id, name, total_price, project_id, approval_status")
    .eq("id", estimateId)
    .maybeSingle();
  if (estErr || !estimate) {
    return { success: false, error: estErr?.message || "Estimate not found" };
  }
  if (estimate.approval_status === "pending_review") {
    return { success: false, error: "Already submitted for review" };
  }

  // Flip status + stamp submission
  const { error: updErr } = await supabase
    .from("estimates")
    .update({
      approval_status: "pending_review",
      submitted_for_review_at: new Date().toISOString(),
      submitted_by: user.id,
    })
    .eq("id", estimateId);
  if (updErr) return { success: false, error: updErr.message };

  // Audit row
  await supabase.from("estimate_approvals").insert({
    estimate_id: estimateId,
    actor_id: user.id,
    actor_email: user.email || null,
    action: "submitted",
    notes: note || null,
  });

  // Best-effort email to Ryan. If Gmail isn't connected we still succeed
  // locally — the review page works off the DB state.
  try {
    let projectLabel = "";
    if (estimate.project_id) {
      const { data: project } = await supabase
        .from("projects")
        .select("name, project_number")
        .eq("id", estimate.project_id)
        .maybeSingle<ProjectForEmail>();
      if (project) {
        projectLabel = project.project_number ? `${project.name} (${project.project_number})` : project.name;
      }
    }
    const e = estimate as EstimateForEmail;
    const reviewUrl = `${appOrigin()}/command-center/reviews/${estimate.id}`;
    const body =
`Jorge submitted a proposal for your review.

Project: ${projectLabel || "—"}
Estimate: ${e.name || "Unnamed"}
Total: ${formatMoney(e.total_price)}

${note ? `Note from Jorge:\n${note}\n\n` : ""}Review + approve:
${reviewUrl}`;
    await sendEmail({
      to: APPROVER_EMAIL,
      subject: `Review needed — ${projectLabel || e.name || "Estimate"}`,
      body,
    });
  } catch (err) {
    console.error("Failed to email Ryan for review:", err);
    // Don't fail the submit just because email failed.
  }

  revalidatePath("/command-center/reviews");
  revalidatePath(`/command-center/reviews/${estimateId}`);
  return { success: true };
}

// Ryan (or any authed user, we check at runtime) → records the decision
export async function recordApprovalDecision(
  estimateId: string,
  decision: "approved" | "changes_requested",
  notes?: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const { data: estimate } = await supabase
    .from("estimates")
    .select("id, name, total_price, project_id, approval_status, submitted_by")
    .eq("id", estimateId)
    .maybeSingle();
  if (!estimate) return { success: false, error: "Estimate not found" };
  if (estimate.approval_status !== "pending_review" && estimate.approval_status !== "approved" && estimate.approval_status !== "changes_requested") {
    return { success: false, error: "Estimate is not in a reviewable state" };
  }

  const newStatus = decision === "approved" ? "approved" : "changes_requested";
  const { error: updErr } = await supabase
    .from("estimates")
    .update({
      approval_status: newStatus,
      approval_notes: notes || null,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", estimateId);
  if (updErr) return { success: false, error: updErr.message };

  await supabase.from("estimate_approvals").insert({
    estimate_id: estimateId,
    actor_id: user.id,
    actor_email: user.email || null,
    action: decision === "approved" ? "approved" : "changes_requested",
    notes: notes || null,
  });

  // Email Jorge so he knows to either send to the client or revise.
  try {
    // Notify whoever submitted (usually Jorge).
    let submitterEmail: string | null = null;
    if (estimate.submitted_by) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("email")
        .eq("id", estimate.submitted_by)
        .maybeSingle<{ email: string | null }>();
      submitterEmail = profile?.email || null;
    }
    if (!submitterEmail) submitterEmail = "jbetancur@penneyconstructioninc.com";

    let projectLabel = "";
    if (estimate.project_id) {
      const { data: project } = await supabase
        .from("projects")
        .select("name, project_number")
        .eq("id", estimate.project_id)
        .maybeSingle<ProjectForEmail>();
      if (project) {
        projectLabel = project.project_number ? `${project.name} (${project.project_number})` : project.name;
      }
    }
    const subject = decision === "approved"
      ? `Approved — ${projectLabel || estimate.name || "Estimate"}`
      : `Changes requested — ${projectLabel || estimate.name || "Estimate"}`;
    const link = `${appOrigin()}/estimates/${estimate.id}`;
    const body = decision === "approved"
      ? `Ryan approved the proposal for ${projectLabel || estimate.name || "this estimate"}.
${notes ? `\nNotes:\n${notes}\n` : ""}
You can send it to the client now.

${link}`
      : `Ryan wants changes to the proposal for ${projectLabel || estimate.name || "this estimate"}.
${notes ? `\nNotes:\n${notes}\n` : ""}
Adjust and resubmit.

${link}`;
    await sendEmail({ to: submitterEmail, subject, body });
  } catch (err) {
    console.error("Failed to email submitter of decision:", err);
  }

  revalidatePath("/command-center/reviews");
  revalidatePath(`/command-center/reviews/${estimateId}`);
  revalidatePath(`/estimates/${estimateId}`);
  return { success: true };
}

export const APPROVER_EMAIL_EXPORT = APPROVER_EMAIL;
