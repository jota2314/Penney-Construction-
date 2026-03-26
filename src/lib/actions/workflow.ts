"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createProjectFolder, createGoogleDoc } from "@/lib/google/drive";
import { createWalkthroughEvent } from "@/lib/google/calendar";
import { sendTemplateEmail } from "@/lib/google/gmail";
import { getNextStage } from "@/lib/constants/workflow";
import type { WorkflowStage, WorkflowActionType } from "@/types/database";

// ── Helpers ──────────────────────────────────────────────────

async function logAction(
  workflowId: string,
  actionType: WorkflowActionType,
  stage: WorkflowStage,
  description: string,
  userId: string,
  metadata: Record<string, unknown> = {}
) {
  const supabase = await createClient();
  await supabase.from("workflow_actions").insert({
    workflow_id: workflowId,
    action_type: actionType,
    stage,
    description,
    metadata,
    performed_by: userId,
  });
}

async function getTemplates(stage: WorkflowStage, recipientType?: string) {
  const supabase = await createClient();
  let query = supabase
    .from("workflow_email_templates")
    .select("*")
    .eq("stage", stage)
    .eq("is_active", true);

  if (recipientType) {
    query = query.eq("recipient_type", recipientType);
  }

  const { data } = await query;
  return data || [];
}

function buildVariables(workflow: Record<string, unknown>): Record<string, string> {
  return {
    project_name: String(workflow.project_name || ""),
    client_name: String(workflow.client_name || ""),
    client_email: String(workflow.client_email || ""),
    project_type: String(workflow.project_type || ""),
    project_address: [
      workflow.project_address,
      workflow.project_city,
      workflow.project_state,
      workflow.project_zip,
    ]
      .filter(Boolean)
      .join(", "),
    project_description: String(workflow.project_description || ""),
    estimate_amount: workflow.estimate_amount
      ? Number(workflow.estimate_amount).toLocaleString("en-US", {
          minimumFractionDigits: 2,
        })
      : "TBD",
    deposit_amount: workflow.deposit_amount
      ? Number(workflow.deposit_amount).toLocaleString("en-US", {
          minimumFractionDigits: 2,
        })
      : "TBD",
    drive_folder_url: String(workflow.google_drive_folder_url || ""),
    sheet_url: String(workflow.google_sheet_url || ""),
    walkthrough_date: workflow.walkthrough_date
      ? new Date(String(workflow.walkthrough_date)).toLocaleString("en-US", {
          dateStyle: "full",
          timeStyle: "short",
        })
      : "TBD",
  };
}

async function getEmailForRole(role: string, workflowData: Record<string, unknown>): Promise<string | null> {
  const supabase = await createClient();

  if (role === "client") {
    return String(workflowData.client_email || "") || null;
  }

  let profileId: string | null = null;
  if (role === "estimator") profileId = workflowData.assigned_estimator as string;
  if (role === "pm") profileId = workflowData.assigned_pm as string;
  if (role === "admin") profileId = workflowData.assigned_admin as string;

  if (!profileId) {
    const roleMap: Record<string, string> = {
      estimator: "precon_manager",
      pm: "project_manager",
      admin: "office_admin",
    };
    const { data } = await supabase
      .from("profiles")
      .select("email")
      .eq("role", roleMap[role] || "owner")
      .limit(1)
      .single();
    return data?.email || null;
  }

  const { data } = await supabase
    .from("profiles")
    .select("email")
    .eq("id", profileId)
    .single();
  return data?.email || null;
}

async function sendStageEmails(
  workflowId: string,
  stage: WorkflowStage,
  workflowData: Record<string, unknown>,
  userId: string
) {
  try {
    const templates = await getTemplates(stage);
    const vars = buildVariables(workflowData);
    for (const tmpl of templates) {
      const recipientEmail = await getEmailForRole(tmpl.recipient_type, workflowData);
      if (recipientEmail) {
        await sendTemplateEmail(tmpl, recipientEmail, vars);
        await logAction(
          workflowId,
          "email_sent",
          stage,
          `Email sent: ${tmpl.template_name} to ${tmpl.recipient_type}`,
          userId,
          { template: tmpl.template_name, to: recipientEmail }
        );
      }
    }
  } catch (e) {
    console.error(`Email send failed for stage ${stage}:`, e);
  }
}

function revalidateWorkflow(workflowId?: string) {
  revalidatePath("/workflow");
  revalidatePath("/dashboard");
  if (workflowId) revalidatePath(`/workflow/${workflowId}`);
}

// ── Create Workflow (Lead Intake) ────────────────────────────

interface CreateWorkflowInput {
  project_name: string;
  client_name: string;
  client_email?: string;
  client_phone?: string;
  project_address?: string;
  project_city?: string;
  project_state?: string;
  project_zip?: string;
  project_type?: string;
  project_description?: string;
  assigned_estimator?: string;
  assigned_admin?: string;
  walkthrough_date?: string;
  lead_id?: string;
}

export async function createWorkflow(input: CreateWorkflowInput) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  // 1. Create the workflow instance
  const { data: workflow, error } = await supabase
    .from("workflow_instances")
    .insert({
      project_name: input.project_name,
      client_name: input.client_name,
      client_email: input.client_email || null,
      client_phone: input.client_phone || null,
      project_address: input.project_address || null,
      project_city: input.project_city || null,
      project_state: input.project_state || null,
      project_zip: input.project_zip || null,
      project_type: input.project_type || null,
      project_description: input.project_description || null,
      assigned_estimator: input.assigned_estimator || null,
      assigned_admin: input.assigned_admin || null,
      walkthrough_date: input.walkthrough_date || null,
      lead_id: input.lead_id || null,
      current_stage: "lead_intake",
      status: "active",
      created_by: user.id,
    })
    .select("*")
    .single();

  if (error) return { error: error.message };

  await logAction(
    workflow.id,
    "stage_advanced",
    "lead_intake",
    `Workflow created for ${input.client_name} - ${input.project_name}`,
    user.id
  );

  const warnings: string[] = [];

  // 2. Create Google Drive folder
  try {
    const result = await createProjectFolder(input.project_name, input.client_name);

    await supabase
      .from("workflow_instances")
      .update({
        google_drive_folder_id: result.folder.id,
        google_drive_folder_url: result.folder.webViewLink,
      })
      .eq("id", workflow.id);

    workflow.google_drive_folder_id = result.folder.id;
    workflow.google_drive_folder_url = result.folder.webViewLink;

    await logAction(workflow.id, "folder_created", "lead_intake",
      `Google Drive folder created: ${result.folder.name}`, user.id,
      { folder_id: result.folder.id, folder_url: result.folder.webViewLink });

    // Create Lead Info document
    const leadInfoFolderId = result.subfolders["01 - Lead Info"]?.id;
    if (leadInfoFolderId) {
      const address = [input.project_address, input.project_city, input.project_state, input.project_zip]
        .filter(Boolean).join(", ");

      const docContent = `# Lead Information — ${input.project_name}

## Client Details

Client Name: ${input.client_name}
Email: ${input.client_email || "N/A"}
Phone: ${input.client_phone || "N/A"}

## Project Details

Project Name: ${input.project_name}
Project Type: ${input.project_type ? input.project_type.replace(/_/g, " ") : "N/A"}
Address: ${address || "N/A"}

## Project Description

${input.project_description || "No description provided."}

## Walkthrough

Scheduled: ${input.walkthrough_date ? new Date(input.walkthrough_date).toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" }) : "Not yet scheduled"}

---

## Notes

`;
      await createGoogleDoc(`Lead Info - ${input.client_name}`, docContent, leadInfoFolderId);
      await logAction(workflow.id, "note_added", "lead_intake", "Lead info document created in Google Drive", user.id);
    }
  } catch (e) {
    warnings.push(`Drive: ${e instanceof Error ? e.message : "Unknown error"}`);
    console.error("Drive failed:", e);
  }

  // 3. Create calendar event if walkthrough date provided
  if (input.walkthrough_date) {
    try {
      const startTime = input.walkthrough_date;
      const endDate = new Date(startTime);
      endDate.setHours(endDate.getHours() + 1);

      const event = await createWalkthroughEvent({
        clientName: input.client_name,
        projectName: input.project_name,
        address: [input.project_address, input.project_city, input.project_state].filter(Boolean).join(", "),
        startTime,
        endTime: endDate.toISOString(),
        attendees: [input.client_email].filter(Boolean) as string[],
      });

      await supabase.from("workflow_instances")
        .update({ google_calendar_event_id: event.id })
        .eq("id", workflow.id);

      await logAction(workflow.id, "meeting_created", "lead_intake",
        `Walkthrough scheduled for ${new Date(startTime).toLocaleDateString()}`, user.id,
        { event_id: event.id, event_url: event.htmlLink });
    } catch (e) {
      warnings.push(`Calendar: ${e instanceof Error ? e.message : "Unknown error"}`);
      console.error("Calendar failed:", e);
    }
  }

  // 4. Send welcome email to client
  await sendStageEmails(workflow.id, "lead_intake", workflow, user.id);

  revalidateWorkflow(workflow.id);
  return { error: null, id: workflow.id, warnings: warnings.length > 0 ? warnings : undefined };
}

// ── Advance Workflow Stage (generic) ─────────────────────────

export async function advanceWorkflowStage(
  workflowId: string,
  additionalData?: Record<string, unknown>
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: workflow, error: fetchError } = await supabase
    .from("workflow_instances")
    .select("*")
    .eq("id", workflowId)
    .single();

  if (fetchError || !workflow) return { error: "Workflow not found" };
  if (workflow.status !== "active") return { error: "Workflow is not active" };

  const nextStage = getNextStage(workflow.current_stage);
  if (!nextStage) return { error: "Workflow is already at the final stage" };

  const updates: Record<string, unknown> = {
    current_stage: nextStage,
    updated_at: new Date().toISOString(),
    ...additionalData,
  };

  // Set stage timestamps
  const timestampMap: Record<string, string> = {
    schedule_confirmation: "schedule_confirmed_at",
    walkthrough: "walkthrough_completed_at",
    estimating: "estimate_sent_at",
    owner_review: "owner_approved_at",
    client_review: "client_approved_at",
    permit_deposit: "deposit_received_confirmed_at",
    job_package: "job_package_created_at",
    pm_handoff: "pm_handoff_at",
    construction_started: "construction_started_at",
    rough_inspection: "rough_inspection_at",
    final_inspection: "final_inspection_at",
    audit: "audit_at",
  };
  if (timestampMap[nextStage]) {
    updates[timestampMap[nextStage]] = new Date().toISOString();
  }

  // Mark completed at audit
  if (nextStage === "audit") {
    updates.completed_at = new Date().toISOString();
    updates.status = "completed";
  }

  const { error: updateError } = await supabase
    .from("workflow_instances")
    .update(updates)
    .eq("id", workflowId);

  if (updateError) return { error: updateError.message };

  await logAction(workflowId, "stage_advanced", nextStage,
    `Workflow advanced to ${nextStage.replace(/_/g, " ")}`, user.id, additionalData || {});

  // Send stage-specific emails
  const updatedWorkflow = { ...workflow, ...updates };
  await sendStageEmails(workflowId, nextStage, updatedWorkflow, user.id);

  revalidateWorkflow(workflowId);
  return { error: null, nextStage };
}

// ── Confirm Schedule (Estimator accepts walkthrough) ─────────

export async function confirmSchedule(workflowId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  return advanceWorkflowStage(workflowId);
}

// ── Reschedule Walkthrough ───────────────────────────────────

export async function rescheduleWalkthrough(
  workflowId: string,
  newDate: string
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: workflow } = await supabase
    .from("workflow_instances")
    .select("*")
    .eq("id", workflowId)
    .single();

  if (!workflow) return { error: "Workflow not found" };

  // Update the walkthrough date
  await supabase.from("workflow_instances")
    .update({ walkthrough_date: newDate, updated_at: new Date().toISOString() })
    .eq("id", workflowId);

  await logAction(workflowId, "schedule_rescheduled", "schedule_confirmation",
    `Walkthrough rescheduled to ${new Date(newDate).toLocaleDateString()}`, user.id);

  // Create new calendar event
  try {
    const endDate = new Date(newDate);
    endDate.setHours(endDate.getHours() + 1);

    const event = await createWalkthroughEvent({
      clientName: workflow.client_name,
      projectName: workflow.project_name,
      address: [workflow.project_address, workflow.project_city, workflow.project_state].filter(Boolean).join(", "),
      startTime: newDate,
      endTime: endDate.toISOString(),
      attendees: [workflow.client_email].filter(Boolean) as string[],
    });

    await supabase.from("workflow_instances")
      .update({ google_calendar_event_id: event.id })
      .eq("id", workflowId);
  } catch (e) {
    console.error("Calendar reschedule failed:", e);
  }

  // Send reschedule email to client
  const updatedWorkflow = { ...workflow, walkthrough_date: newDate };
  await sendStageEmails(workflowId, "schedule_confirmation", updatedWorkflow, user.id);

  revalidateWorkflow(workflowId);
  return { error: null };
}

// ── Complete Walkthrough ─────────────────────────────────────

export async function completeWalkthrough(workflowId: string) {
  return advanceWorkflowStage(workflowId);
}

// ── Link Estimate Sheet ──────────────────────────────────────

export async function linkEstimateSheet(
  workflowId: string,
  sheetUrl: string
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  await supabase.from("workflow_instances")
    .update({
      google_sheet_url: sheetUrl,
      estimate_sheet_linked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", workflowId);

  await logAction(workflowId, "estimate_sent", "estimating",
    "Estimate sheet linked to workflow", user.id, { sheet_url: sheetUrl });

  revalidateWorkflow(workflowId);
  return { error: null };
}

// ── Submit Estimate for Owner Review ─────────────────────────

export async function submitEstimateForReview(
  workflowId: string,
  estimateAmount?: number
) {
  return advanceWorkflowStage(workflowId, {
    ...(estimateAmount ? { estimate_amount: estimateAmount } : {}),
  });
}

// ── Owner Approves Estimate ──────────────────────────────────

export async function ownerApproveEstimate(workflowId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  await logAction(workflowId, "owner_approved", "owner_review",
    "Owner approved the estimate", user.id);

  // Generate a client approval token
  const token = crypto.randomUUID();
  return advanceWorkflowStage(workflowId, {
    owner_approved_at: new Date().toISOString(),
    client_approval_token: token,
  });
}

// ── Client Approves (manual or via link) ─────────────────────

export async function clientApprove(workflowId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  await logAction(workflowId, "client_approved", "client_review",
    "Client approved the estimate", user.id);

  return advanceWorkflowStage(workflowId, {
    client_approved_at: new Date().toISOString(),
  });
}

// ── Client Approve via Token (from email link) ───────────────

export async function clientApproveByToken(token: string) {
  const supabase = await createClient();

  const { data: workflow } = await supabase
    .from("workflow_instances")
    .select("*")
    .eq("client_approval_token", token)
    .eq("current_stage", "client_review")
    .single();

  if (!workflow) return { error: "Invalid or expired approval link" };

  const { error } = await supabase
    .from("workflow_instances")
    .update({
      current_stage: "permit_deposit",
      client_approved_at: new Date().toISOString(),
      client_approval_token: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", workflow.id);

  if (error) return { error: error.message };

  await logAction(workflow.id, "client_approved", "client_review",
    "Client approved via email link", workflow.created_by);

  // Send emails for permit_deposit stage (to Nicole)
  const updatedWorkflow = { ...workflow, current_stage: "permit_deposit" };
  await sendStageEmails(workflow.id, "permit_deposit", updatedWorkflow, workflow.created_by);

  revalidateWorkflow(workflow.id);
  return { error: null, workflowId: workflow.id };
}

// ── Record Deposit & Request Permit ──────────────────────────

export async function recordDepositAndPermit(
  workflowId: string,
  depositAmount: number
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  await logAction(workflowId, "deposit_received", "permit_deposit",
    `Deposit of $${depositAmount.toLocaleString()} received`, user.id);

  return advanceWorkflowStage(workflowId, {
    deposit_amount: depositAmount,
    deposit_received_at: new Date().toISOString(),
  });
}

// ── Permit Pulled → Job Package ──────────────────────────────

export async function permitPulled(workflowId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  await logAction(workflowId, "permit_pulled", "permit_deposit",
    "Permit has been pulled", user.id);

  return advanceWorkflowStage(workflowId, {
    permit_pulled_at: new Date().toISOString(),
  });
}

// ── Mark Job Package Created ─────────────────────────────────

export async function markJobPackageCreated(
  workflowId: string,
  assignedPm?: string
) {
  return advanceWorkflowStage(workflowId, {
    ...(assignedPm ? { assigned_pm: assignedPm } : {}),
  });
}

// ── PM Handoff ───────────────────────────────────────────────

export async function pmHandoff(workflowId: string) {
  return advanceWorkflowStage(workflowId);
}

// ── Construction Started ─────────────────────────────────────

export async function startConstruction(workflowId: string) {
  return advanceWorkflowStage(workflowId);
}

// ── Inspections ──────────────────────────────────────────────

export async function completeRoughInspection(workflowId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  await logAction(workflowId, "inspection_passed", "rough_inspection",
    "Rough inspection passed", user.id);

  return advanceWorkflowStage(workflowId);
}

export async function completeFinalInspection(workflowId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  await logAction(workflowId, "inspection_passed", "final_inspection",
    "Final inspection passed", user.id);

  return advanceWorkflowStage(workflowId);
}

// ── Complete Audit ───────────────────────────────────────────

export async function completeAudit(workflowId: string) {
  return advanceWorkflowStage(workflowId);
}

// ── Schedule Walkthrough ─────────────────────────────────────

export async function scheduleWalkthrough(
  workflowId: string,
  walkthroughDate: string
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: workflow } = await supabase
    .from("workflow_instances")
    .select("*")
    .eq("id", workflowId)
    .single();

  if (!workflow) return { error: "Workflow not found" };

  try {
    const endDate = new Date(walkthroughDate);
    endDate.setHours(endDate.getHours() + 1);

    const event = await createWalkthroughEvent({
      clientName: workflow.client_name,
      projectName: workflow.project_name,
      address: [workflow.project_address, workflow.project_city, workflow.project_state].filter(Boolean).join(", "),
      startTime: walkthroughDate,
      endTime: endDate.toISOString(),
      attendees: [workflow.client_email].filter(Boolean) as string[],
    });

    await supabase.from("workflow_instances")
      .update({ walkthrough_date: walkthroughDate, google_calendar_event_id: event.id })
      .eq("id", workflowId);

    await logAction(workflowId, "meeting_created", workflow.current_stage as WorkflowStage,
      `Walkthrough scheduled for ${new Date(walkthroughDate).toLocaleDateString()}`, user.id);
  } catch (e) {
    console.error("Calendar failed:", e);
    await supabase.from("workflow_instances")
      .update({ walkthrough_date: walkthroughDate })
      .eq("id", workflowId);
  }

  revalidateWorkflow(workflowId);
  return { error: null };
}

// ── CRUD Operations ──────────────────────────────────────────

export async function getWorkflow(workflowId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated", data: null };

  const { data, error } = await supabase
    .from("workflow_instances")
    .select("*")
    .eq("id", workflowId)
    .single();

  if (error) return { error: error.message, data: null };
  return { error: null, data };
}

export async function listWorkflows(filters?: { status?: string; stage?: string }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated", data: [] };

  let query = supabase
    .from("workflow_instances")
    .select("*")
    .order("created_at", { ascending: false });

  if (filters?.status) query = query.eq("status", filters.status);
  if (filters?.stage) query = query.eq("current_stage", filters.stage);

  const { data, error } = await query;
  if (error) return { error: error.message, data: [] };
  return { error: null, data: data || [] };
}

export async function getWorkflowActions(workflowId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workflow_actions")
    .select("*")
    .eq("workflow_id", workflowId)
    .order("created_at", { ascending: false });

  if (error) return { error: error.message, data: [] };
  return { error: null, data: data || [] };
}

export async function updateWorkflow(
  workflowId: string,
  updates: Record<string, unknown>
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("workflow_instances")
    .update(updates)
    .eq("id", workflowId);

  if (error) return { error: error.message };
  revalidateWorkflow(workflowId);
  return { error: null };
}

export async function cancelWorkflow(workflowId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("workflow_instances")
    .update({ status: "cancelled" })
    .eq("id", workflowId);

  if (error) return { error: error.message };
  await logAction(workflowId, "note_added", "lead_intake", "Workflow cancelled", user.id);
  revalidateWorkflow();
  return { error: null };
}

export async function deleteWorkflow(workflowId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("workflow_instances")
    .delete()
    .eq("id", workflowId);

  if (error) return { error: error.message };
  revalidateWorkflow();
  return { error: null };
}
