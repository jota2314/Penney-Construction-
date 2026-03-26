"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createProjectFolder, createGoogleDoc } from "@/lib/google/drive";
import { createWalkthroughEvent } from "@/lib/google/calendar";
import { sendTemplateEmail } from "@/lib/google/gmail";
import { getNextStage, STAGE_ORDER } from "@/lib/constants/workflow";
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
    // Fallback: find a user with the matching role
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

// ── Create Workflow ──────────────────────────────────────────

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

  // 2. Log the creation
  await logAction(
    workflow.id,
    "stage_advanced",
    "lead_intake",
    `Workflow created for ${input.client_name} - ${input.project_name}`,
    user.id
  );

  // 3. Try to create Google Drive folder in Shared Drive
  const errors: string[] = [];
  let leadInfoFolderId: string | null = null;

  try {
    const result = await createProjectFolder(
      input.project_name,
      input.client_name
    );

    await supabase
      .from("workflow_instances")
      .update({
        google_drive_folder_id: result.folder.id,
        google_drive_folder_url: result.folder.webViewLink,
      })
      .eq("id", workflow.id);

    workflow.google_drive_folder_id = result.folder.id;
    workflow.google_drive_folder_url = result.folder.webViewLink;
    leadInfoFolderId = result.subfolders["01 - Lead Info"]?.id || null;

    await logAction(
      workflow.id,
      "folder_created",
      "lead_intake",
      `Google Drive folder created: ${result.folder.name}`,
      user.id,
      { folder_id: result.folder.id, folder_url: result.folder.webViewLink }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown Drive error";
    errors.push(`Drive: ${msg}`);
    console.error("Drive folder creation failed:", e);
  }

  // 3b. Create Lead Info document in the subfolder
  if (leadInfoFolderId) {
    try {
      const address = [input.project_address, input.project_city, input.project_state, input.project_zip]
        .filter(Boolean)
        .join(", ");

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

      await createGoogleDoc(
        `Lead Info - ${input.client_name}`,
        docContent,
        leadInfoFolderId
      );

      await logAction(
        workflow.id,
        "note_added",
        "lead_intake",
        "Lead info document created in Google Drive",
        user.id
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      errors.push(`Lead doc: ${msg}`);
      console.error("Lead info doc creation failed:", e);
    }
  }

  // 4. Create calendar event if walkthrough date is provided
  if (input.walkthrough_date) {
    try {
      const startTime = input.walkthrough_date;
      const endDate = new Date(startTime);
      endDate.setHours(endDate.getHours() + 1);
      const endTime = endDate.toISOString();

      const attendees = [input.client_email].filter(Boolean) as string[];

      const event = await createWalkthroughEvent({
        clientName: input.client_name,
        projectName: input.project_name,
        address: [input.project_address, input.project_city, input.project_state]
          .filter(Boolean)
          .join(", "),
        startTime,
        endTime,
        attendees,
      });

      await supabase
        .from("workflow_instances")
        .update({ google_calendar_event_id: event.id })
        .eq("id", workflow.id);

      await logAction(
        workflow.id,
        "meeting_created",
        "lead_intake",
        `Walkthrough meeting created for ${new Date(startTime).toLocaleDateString()}`,
        user.id,
        { event_id: event.id, event_url: event.htmlLink }
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown Calendar error";
      errors.push(`Calendar: ${msg}`);
      console.error("Calendar event creation failed:", e);
    }
  }

  // 5. Send welcome email to client
  if (input.client_email) {
    try {
      const templates = await getTemplates("lead_intake", "client");
      const vars = buildVariables(workflow);
      for (const tmpl of templates) {
        await sendTemplateEmail(tmpl, input.client_email, vars);
        await logAction(
          workflow.id,
          "email_sent",
          "lead_intake",
          `Welcome email sent to ${input.client_email}`,
          user.id,
          { template: tmpl.template_name, to: input.client_email }
        );
      }
    } catch (e) {
      console.error("Email send failed (will continue):", e);
    }
  }

  // 6. Send notification email to estimator
  try {
    const estimatorEmail = await getEmailForRole("estimator", workflow);
    if (estimatorEmail) {
      const templates = await getTemplates("lead_intake", "estimator");
      const vars = buildVariables(workflow);
      for (const tmpl of templates) {
        await sendTemplateEmail(tmpl, estimatorEmail, vars);
        await logAction(
          workflow.id,
          "email_sent",
          "lead_intake",
          `Lead assignment email sent to estimator`,
          user.id,
          { template: tmpl.template_name, to: estimatorEmail }
        );
      }
    }
  } catch (e) {
    console.error("Estimator notification failed (will continue):", e);
  }

  revalidatePath("/workflow");
  revalidatePath("/dashboard");
  return {
    error: null,
    id: workflow.id,
    warnings: errors.length > 0 ? errors : undefined,
  };
}

// ── Advance Workflow Stage ───────────────────────────────────

export async function advanceWorkflowStage(
  workflowId: string,
  additionalData?: Record<string, unknown>
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  // Fetch current workflow
  const { data: workflow, error: fetchError } = await supabase
    .from("workflow_instances")
    .select("*")
    .eq("id", workflowId)
    .single();

  if (fetchError || !workflow) return { error: "Workflow not found" };
  if (workflow.status !== "active") return { error: "Workflow is not active" };

  const nextStage = getNextStage(workflow.current_stage);
  if (!nextStage) return { error: "Workflow is already at the final stage" };

  // Build the update payload
  const updates: Record<string, unknown> = {
    current_stage: nextStage,
    ...additionalData,
  };

  // Set stage timestamps
  const timestampMap: Record<string, string> = {
    walkthrough: "walkthrough_completed_at",
    estimating: "estimate_sent_at",
    client_review: "client_approved_at",
    admin_deposit: "deposit_received_confirmed_at",
    job_package: "job_package_created_at",
    project_management: "assigned_to_pm_at",
  };
  if (timestampMap[nextStage]) {
    updates[timestampMap[nextStage]] = new Date().toISOString();
  }

  // If reaching final stage, mark completed
  if (nextStage === "project_management") {
    updates.completed_at = new Date().toISOString();
    updates.status = "completed";
  }

  const { error: updateError } = await supabase
    .from("workflow_instances")
    .update(updates)
    .eq("id", workflowId);

  if (updateError) return { error: updateError.message };

  // Log the advancement
  await logAction(
    workflowId,
    "stage_advanced",
    nextStage,
    `Workflow advanced to ${nextStage.replace(/_/g, " ")}`,
    user.id,
    additionalData || {}
  );

  // Merge updates into workflow for email variables
  const updatedWorkflow = { ...workflow, ...updates };
  const vars = buildVariables(updatedWorkflow);

  // Send stage-specific emails
  try {
    const templates = await getTemplates(nextStage);
    for (const tmpl of templates) {
      const recipientEmail = await getEmailForRole(tmpl.recipient_type, updatedWorkflow);
      if (recipientEmail) {
        await sendTemplateEmail(tmpl, recipientEmail, vars);
        await logAction(
          workflowId,
          "email_sent",
          nextStage,
          `Email sent: ${tmpl.template_name} to ${tmpl.recipient_type}`,
          user.id,
          { template: tmpl.template_name, to: recipientEmail }
        );
      }
    }
  } catch (e) {
    console.error("Stage email send failed (will continue):", e);
  }

  revalidatePath("/workflow");
  revalidatePath(`/workflow/${workflowId}`);
  revalidatePath("/dashboard");
  return { error: null, nextStage };
}

// ── Record Client Approval ───────────────────────────────────

export async function recordClientApproval(workflowId: string) {
  return advanceWorkflowStage(workflowId, {
    client_approved_at: new Date().toISOString(),
  });
}

// ── Record Deposit ───────────────────────────────────────────

export async function recordDeposit(
  workflowId: string,
  depositAmount: number
) {
  return advanceWorkflowStage(workflowId, {
    deposit_amount: depositAmount,
    deposit_received_at: new Date().toISOString(),
  });
}

// ── Mark Job Package Created ─────────────────────────────────

export async function markJobPackageCreated(
  workflowId: string,
  assignedPm: string
) {
  return advanceWorkflowStage(workflowId, {
    assigned_pm: assignedPm,
  });
}

// ── Get Workflow Details ─────────────────────────────────────

export async function getWorkflow(workflowId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated", data: null };

  const { data, error } = await supabase
    .from("workflow_instances")
    .select("*")
    .eq("id", workflowId)
    .single();

  if (error) return { error: error.message, data: null };
  return { error: null, data };
}

// ── List Workflows ───────────────────────────────────────────

export async function listWorkflows(filters?: {
  status?: string;
  stage?: string;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated", data: [] };

  let query = supabase
    .from("workflow_instances")
    .select("*")
    .order("created_at", { ascending: false });

  if (filters?.status) {
    query = query.eq("status", filters.status);
  }
  if (filters?.stage) {
    query = query.eq("current_stage", filters.stage);
  }

  const { data, error } = await query;
  if (error) return { error: error.message, data: [] };
  return { error: null, data: data || [] };
}

// ── Get Workflow Actions ─────────────────────────────────────

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

// ── Update Workflow ──────────────────────────────────────────

export async function updateWorkflow(
  workflowId: string,
  updates: Record<string, unknown>
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("workflow_instances")
    .update(updates)
    .eq("id", workflowId);

  if (error) return { error: error.message };

  revalidatePath("/workflow");
  revalidatePath(`/workflow/${workflowId}`);
  return { error: null };
}

// ── Schedule Walkthrough (creates calendar event) ────────────

export async function scheduleWalkthrough(
  workflowId: string,
  walkthroughDate: string
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: workflow } = await supabase
    .from("workflow_instances")
    .select("*")
    .eq("id", workflowId)
    .single();

  if (!workflow) return { error: "Workflow not found" };

  // Create calendar event
  try {
    const startTime = walkthroughDate;
    const endDate = new Date(startTime);
    endDate.setHours(endDate.getHours() + 1);

    const attendees = [workflow.client_email].filter(Boolean) as string[];

    const event = await createWalkthroughEvent({
      clientName: workflow.client_name,
      projectName: workflow.project_name,
      address: [workflow.project_address, workflow.project_city, workflow.project_state]
        .filter(Boolean)
        .join(", "),
      startTime,
      endTime: endDate.toISOString(),
      attendees,
    });

    await supabase
      .from("workflow_instances")
      .update({
        walkthrough_date: walkthroughDate,
        google_calendar_event_id: event.id,
      })
      .eq("id", workflowId);

    await logAction(
      workflowId,
      "meeting_created",
      "walkthrough",
      `Walkthrough scheduled for ${new Date(walkthroughDate).toLocaleDateString()}`,
      user.id,
      { event_id: event.id }
    );

    // Send walkthrough scheduled email to client
    if (workflow.client_email) {
      const templates = await getTemplates("walkthrough", "client");
      const vars = buildVariables({
        ...workflow,
        walkthrough_date: walkthroughDate,
      });
      for (const tmpl of templates) {
        await sendTemplateEmail(tmpl, workflow.client_email, vars);
      }
    }
  } catch (e) {
    console.error("Calendar/email failed:", e);
    // Still update the date even if Google API fails
    await supabase
      .from("workflow_instances")
      .update({ walkthrough_date: walkthroughDate })
      .eq("id", workflowId);
  }

  revalidatePath("/workflow");
  revalidatePath(`/workflow/${workflowId}`);
  return { error: null };
}

// ── Cancel Workflow ──────────────────────────────────────────

export async function cancelWorkflow(workflowId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("workflow_instances")
    .update({ status: "cancelled" })
    .eq("id", workflowId);

  if (error) return { error: error.message };

  await logAction(
    workflowId,
    "note_added",
    "lead_intake",
    "Workflow cancelled",
    user.id
  );

  revalidatePath("/workflow");
  return { error: null };
}

// ── Delete Workflow ──────────────────────────────────────────

export async function deleteWorkflow(workflowId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("workflow_instances")
    .delete()
    .eq("id", workflowId);

  if (error) return { error: error.message };

  revalidatePath("/workflow");
  revalidatePath("/dashboard");
  return { error: null };
}
