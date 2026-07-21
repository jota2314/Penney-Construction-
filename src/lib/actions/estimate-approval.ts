"use server";

import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/google/gmail";
import { revalidatePath } from "next/cache";
import { getUser } from "@/lib/auth/get-user";
import { canReviewEstimates } from "@/lib/auth/role-access";

// Ryan is the approver. Hardcoded for now — if we add other owners later
// we swap this for a role check on profiles.
const APPROVER_EMAIL = "rpenney@penneyconstructioninc.com";

// Every approval action is limited to owners + precon (Ryan, Shannon,
// Nicole, Jorge) — PMs, office admins, and field can't submit or decide.
async function reviewerGateError(): Promise<string | null> {
  const viewer = await getUser();
  if (!viewer) return "Not authenticated";
  if (!canReviewEstimates(viewer.profile?.role)) {
    return "Proposal reviews are limited to owners and precon.";
  }
  return null;
}

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

// Fetch the generated proposal PDF as a base64 attachment for the review
// email. Skips silently if the fetch fails — email still goes out with the
// link. PDF only; Jorge retired the .xlsx format.
async function buildProposalAttachments(
  projectId: string,
  projectLabel: string,
  estimateId?: string,
): Promise<Array<{ filename: string; mimeType: string; content: string }>> {
  const base = appOrigin();
  const safeName = projectLabel.replace(/[^a-z0-9 _-]/gi, "").trim() || "Proposal";

  const { headers } = await import("next/headers");
  const cookieHeader = (await headers()).get("cookie") || "";

  // Pin the exact estimate being submitted. Without estimateId the route
  // falls back to "latest version" which silently sends Ryan the wrong
  // option on multi-option projects (Caraglia Option A vs Option B).
  const pdfUrl = new URL("/api/generate-proposal-pdf", base);
  pdfUrl.searchParams.set("projectId", projectId);
  if (estimateId) pdfUrl.searchParams.set("estimateId", estimateId);

  try {
    const res = await fetch(
      pdfUrl.toString(),
      { headers: { cookie: cookieHeader }, cache: "no-store" },
    );
    if (!res.ok) return [];
    const buf = Buffer.from(await res.arrayBuffer());
    return [{
      filename: `${safeName} - Proposal.pdf`,
      mimeType: "application/pdf",
      content: buf.toString("base64"),
    }];
  } catch {
    return [];
  }
}

// Jorge → Ryan: send for review
export async function submitEstimateForReview(
  estimateId: string,
  note?: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated" };
  const reviewerErr = await reviewerGateError();
  if (reviewerErr) return { success: false, error: reviewerErr };

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

  // Flip estimate status + stamp submission
  const { error: updErr } = await supabase
    .from("estimates")
    .update({
      approval_status: "pending_review",
      submitted_for_review_at: new Date().toISOString(),
      submitted_by: user.id,
    })
    .eq("id", estimateId);
  if (updErr) return { success: false, error: updErr.message };

  // Flip the parent project to "waiting_for_approval" so the projects
  // list surfaces what's sitting in Ryan's inbox.
  if (estimate.project_id) {
    await supabase
      .from("projects")
      .update({ status: "waiting_for_approval" })
      .eq("id", estimate.project_id);
  }

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

${note ? `Note from Jorge:\n${note}\n\n` : ""}PDF is attached.

Review + approve:
${reviewUrl}`;

    // Fetch PDF + Excel and attach both so Ryan has everything inline.
    const attachments = estimate.project_id
      ? await buildProposalAttachments(estimate.project_id, projectLabel || e.name || "Proposal", estimate.id)
      : [];

    await sendEmail({
      to: APPROVER_EMAIL,
      subject: `Review needed — ${projectLabel || e.name || "Estimate"}`,
      body,
      attachments,
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
  const reviewerErr = await reviewerGateError();
  if (reviewerErr) return { success: false, error: reviewerErr };

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

  // Flip the parent project out of waiting_for_approval: approved → proposal_sent
  // (ready to send to the client), changes_requested → back to estimating.
  if (estimate.project_id) {
    await supabase
      .from("projects")
      .update({ status: decision === "approved" ? "proposal_sent" : "estimating" })
      .eq("id", estimate.project_id);
  }

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

// Send the review email to Ryan with the proposal PDF attached. Use this
// when the estimate is already in pending_review (so submitEstimateForReview
// errors out) but the email never made it, or Ryan needs another copy.
export async function sendReviewEmailToRyan(
  estimateId: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated" };
  const reviewerErr = await reviewerGateError();
  if (reviewerErr) return { success: false, error: reviewerErr };

  const { data: estimate } = await supabase
    .from("estimates")
    .select("id, name, total_price, project_id, submitted_for_review_at")
    .eq("id", estimateId)
    .maybeSingle();
  if (!estimate) return { success: false, error: "Estimate not found" };

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

PDF is attached.

Review + approve:
${reviewUrl}`;

  const attachments = estimate.project_id
    ? await buildProposalAttachments(estimate.project_id, projectLabel || e.name || "Proposal")
    : [];

  // Make sure submitted_for_review_at is set (state was likely flipped via
  // SQL or Ryan needs another copy).
  await supabase
    .from("estimates")
    .update({
      submitted_for_review_at: new Date().toISOString(),
      submitted_by: user.id,
    })
    .eq("id", estimateId);

  await supabase.from("estimate_approvals").insert({
    estimate_id: estimateId,
    actor_id: user.id,
    actor_email: user.email || null,
    action: "submitted",
    notes: "Sent review email to Ryan from review page",
  });

  try {
    await sendEmail({
      to: APPROVER_EMAIL,
      subject: `Review needed — ${projectLabel || e.name || "Estimate"}`,
      body,
      attachments,
    });
  } catch (err) {
    console.error("Failed to send review email to Ryan:", err);
    return { success: false, error: err instanceof Error ? err.message : "Email failed" };
  }

  revalidatePath("/command-center/reviews");
  revalidatePath(`/command-center/reviews/${estimateId}`);
  return { success: true };
}

// TEMPORARY — wired to a "TEST" button on the review page so Jorge can
// click once and (a) approve the estimate, (b) receive the proposal email
// at his own inbox instead of the real client. Remove the button + this
// action when end-to-end testing is done.
export async function approveAndTestEmailProposal(
  estimateId: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated" };
  const reviewerErr = await reviewerGateError();
  if (reviewerErr) return { success: false, error: reviewerErr };

  const TEST_RECIPIENT = "jorgebetancurfx@gmail.com";

  const { data: estimate, error: fetchErr } = await supabase
    .from("estimates")
    .select("id, name, total_price, project_id")
    .eq("id", estimateId)
    .maybeSingle();
  if (fetchErr || !estimate) return { success: false, error: fetchErr?.message || "Estimate not found" };

  const { error: updErr } = await supabase
    .from("estimates")
    .update({
      approval_status: "approved",
      approval_notes: "TEST approval — proposal emailed to Jorge",
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", estimateId);
  if (updErr) return { success: false, error: updErr.message };

  if (estimate.project_id) {
    await supabase
      .from("projects")
      .update({ status: "proposal_sent" })
      .eq("id", estimate.project_id);
  }

  await supabase.from("estimate_approvals").insert({
    estimate_id: estimateId,
    actor_id: user.id,
    actor_email: user.email || null,
    action: "approved",
    notes: "TEST approval — proposal emailed to Jorge instead of client",
  });

  let projectLabel = "Proposal";
  if (estimate.project_id) {
    const { data: project } = await supabase
      .from("projects")
      .select("name, project_number")
      .eq("id", estimate.project_id)
      .maybeSingle<ProjectForEmail>();
    if (project) projectLabel = project.project_number ? `${project.name} (${project.project_number})` : project.name;
  }

  const e = estimate as EstimateForEmail;
  const attachments = estimate.project_id
    ? await buildProposalAttachments(estimate.project_id, projectLabel)
    : [];

  try {
    await sendEmail({
      to: TEST_RECIPIENT,
      subject: `TEST — Proposal for ${projectLabel}`,
      body:
`This is a test send of the proposal email — going to you instead of the client.

Project: ${projectLabel}
Total: ${formatMoney(e.total_price)}

Attached PDF is exactly what would go to the client when you actually send.`,
      attachments,
    });
  } catch (err) {
    console.error("Failed to test-email proposal to Jorge:", err);
    return { success: false, error: err instanceof Error ? err.message : "Email failed" };
  }

  revalidatePath("/command-center/reviews");
  revalidatePath(`/command-center/reviews/${estimateId}`);
  revalidatePath(`/estimates/${estimateId}`);
  return { success: true };
}

// Self-approve — solo-use / dev shortcut that skips the review round
// entirely. Records a single audit entry so the trail is still honest.
export async function selfApproveEstimate(
  estimateId: string,
  note?: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated" };
  const reviewerErr = await reviewerGateError();
  if (reviewerErr) return { success: false, error: reviewerErr };

  const { data: estimate, error: fetchErr } = await supabase
    .from("estimates")
    .select("id, project_id")
    .eq("id", estimateId)
    .maybeSingle();
  if (fetchErr || !estimate) return { success: false, error: fetchErr?.message || "Estimate not found" };

  const { error: updErr } = await supabase
    .from("estimates")
    .update({
      approval_status: "approved",
      approval_notes: note || null,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      submitted_by: user.id,
      submitted_for_review_at: new Date().toISOString(),
    })
    .eq("id", estimateId);
  if (updErr) return { success: false, error: updErr.message };

  // Self-approve implies it's ready to send to the client.
  if (estimate.project_id) {
    await supabase
      .from("projects")
      .update({ status: "proposal_sent" })
      .eq("id", estimate.project_id);
  }

  await supabase.from("estimate_approvals").insert({
    estimate_id: estimateId,
    actor_id: user.id,
    actor_email: user.email || null,
    action: "approved",
    notes: note ? `Self-approved — ${note}` : "Self-approved (no separate review round)",
  });

  revalidatePath("/command-center/reviews");
  revalidatePath(`/command-center/reviews/${estimateId}`);
  revalidatePath(`/estimates/${estimateId}`);
  return { success: true };
}
