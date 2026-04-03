"use server";

import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/google/gmail";

// Team directory — all known emails for fast lookup
const TEAM_EMAILS: Record<string, string> = {
  ryan: "rpenney@penneyconstructioninc.com",
  "ryan penney": "rpenney@penneyconstructioninc.com",
  jorge: "jbetancur@penneyconstructioninc.com",
  "jorge betancur": "jbetancur@penneyconstructioninc.com",
  nicole: "nsmith@penneyconstructioninc.com",
  "nicole smith": "nsmith@penneyconstructioninc.com",
  howie: "hclick@penneyconstructioninc.com",
  "howie clickstein": "hclick@penneyconstructioninc.com",
  wayne: "wdobrosielski@penneyconstructioninc.com",
  "wayne dobrosielski": "wdobrosielski@penneyconstructioninc.com",
  steve: "sriley@penneyconstructioninc.com",
  steven: "sriley@penneyconstructioninc.com",
  "steven riley": "sriley@penneyconstructioninc.com",
  dylan: "dwieselquist@me.com",
  "dylan wieselquist": "dwieselquist@me.com",
  angel: "apaulino@penneyconstructioninc.com",
  "angel paulino": "apaulino@penneyconstructioninc.com",
  mason: "mclick@penneyconstructioninc.com",
  "mason clickstein": "mclick@penneyconstructioninc.com",
};

/**
 * Look up an assignee's email — checks team directory, then employees table.
 */
async function findAssigneeEmail(assigneeName: string): Promise<string | null> {
  const nameLower = assigneeName.toLowerCase().trim();

  // Check hardcoded team first
  if (TEAM_EMAILS[nameLower]) return TEAM_EMAILS[nameLower];

  // Check employees table
  const supabase = await createClient();
  const firstName = nameLower.split(" ")[0];

  const { data: employee } = await supabase
    .from("employees")
    .select("email")
    .or(`first_name.ilike.${firstName},last_name.ilike.${firstName}`)
    .eq("status", "active")
    .limit(1)
    .single();

  return employee?.email || null;
}

/**
 * Send a task assignment email notification.
 * Called when a todo is created with an assignee.
 */
export async function notifyAssignee(opts: {
  assignee: string;
  description: string;
  projectName?: string | null;
  priority?: string;
  dueDate?: string | null;
}) {
  const { assignee, description, projectName, priority, dueDate } = opts;
  if (!assignee) return;

  const email = await findAssigneeEmail(assignee);
  if (!email) return; // No email found — skip silently

  const firstName = assignee.split(" ")[0];
  const projectLine = projectName ? `Project: ${projectName}` : "";
  const priorityLine = priority && priority !== "medium" ? `Priority: ${priority.toUpperCase()}` : "";
  const dueLine = dueDate ? `Due: ${new Date(dueDate).toLocaleDateString()}` : "";

  const body = `Hi ${firstName},

You have a new task assigned to you:

${description}
${[projectLine, priorityLine, dueLine].filter(Boolean).join("\n")}

Open the Penney Construction app to see details and mark it done when complete.

Jorge Betancur
Penney Construction Inc.
617-596-2476`;

  try {
    await sendEmail({
      to: email,
      subject: `New Task: ${description.substring(0, 60)}${description.length > 60 ? "..." : ""}`,
      body,
    });

    // Log the notification
    const supabase = await createClient();
    await supabase.from("email_logs").insert({
      subject: `Task assigned to ${assignee}: ${description.substring(0, 100)}`,
      from_email: "jbetancur@penneyconstructioninc.com",
      to_email: email,
      direction: "outbound",
      category: "internal",
      sent_at: new Date().toISOString(),
    });
  } catch {
    // Email send failed — don't block todo creation
  }
}
