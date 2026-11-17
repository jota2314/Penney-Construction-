"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/auth/get-user";
import { canManageProjectDocuments } from "@/lib/auth/project-document-access";
import { getScopedProjectIds } from "@/lib/auth/scoped-projects";
import { priceFreeScopeText } from "@/lib/site-qr/scope-text";
import { isSiteOpen } from "@/lib/sub-portal/site-code";
import { createClient } from "@/lib/supabase/server";

const assignmentEdit = z.object({
  projectId: z.string().uuid(),
  rosterId: z.string().uuid(),
  updatedAt: z.string().datetime({ offset: true }),
  text: z.string().max(4000),
});

export async function savePortalAssignment(input: z.input<typeof assignmentEdit>) {
  const parsed = assignmentEdit.safeParse(input);
  if (!parsed.success) return { error: "Check the assignment and keep it within 4,000 characters." };
  const user = await getUser();
  if (!user || !canManageProjectDocuments(user.profile?.role)) {
    return { error: "Only office staff and project managers can publish a job assignment." };
  }
  const { projectId, rosterId, updatedAt, text } = parsed.data;
  const scope = priceFreeScopeText(text) || null;
  if (text.trim() && !scope) return { error: "Enter field instructions that can be shown in the portal." };

  const supabase = await createClient();
  const projects = await getScopedProjectIds(supabase, user.profile);
  if (projects && !projects.has(projectId)) return { error: "This project is unavailable." };
  const { data: project, error: readError } = await supabase.from("projects")
    .select("name, project_number, status, is_overhead").eq("id", projectId).maybeSingle();
  if (readError || !project || !isSiteOpen(project)) return { error: "This project is unavailable for field assignments." };

  // The row version and active status are checked by the UPDATE itself. Only
  // the field text is written, including on a financially locked work order.
  const { data, error } = await supabase.from("project_subcontractors")
    .update({ scope_summary: scope })
    .eq("id", rosterId).eq("project_id", projectId).eq("status", "active")
    .eq("updated_at", updatedAt)
    .select("id").maybeSingle();
  if (error) return { error: "The assignment could not be saved. Try again." };
  if (!data) return { error: "This assignment changed or is no longer active. Reopen it to review the latest version.", conflict: true };
  revalidatePath(`/projects/${projectId}`);
  return { error: null };
}
