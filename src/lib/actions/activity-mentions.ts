"use server";

import { createClient } from "@/lib/supabase/server";

export type ActivityMention = {
  id: string;
  type: "job" | "worker" | "subcontractor";
  label: string;
  detail: string;
  token: string;
};

function mentionToken(value: string): string {
  const parts = value
    .trim()
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  return parts.map((part) => part[0]?.toUpperCase() + part.slice(1)).join("");
}

/**
 * Mention choices for a jobsite activity post. Assigned subcontractors sort
 * first, while the full active directory remains searchable for the cases
 * where a new sub has not been linked to the project yet.
 */
export async function listActivityMentions(projectId: string): Promise<ActivityMention[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const [projectResult, employeesResult, subcontractorsResult, assignmentsResult] =
    await Promise.all([
      supabase
        .from("projects")
        .select("id, name, project_number")
        .eq("id", projectId)
        .maybeSingle(),
      supabase
        .from("employees")
        .select("id, first_name, last_name, title")
        .eq("status", "active")
        .order("first_name", { ascending: true }),
      supabase
        .from("subcontractors")
        .select("id, company_name, contact_name, trades")
        .eq("is_active", true)
        .order("company_name", { ascending: true })
        .limit(200),
      supabase
        .from("project_subcontractors")
        .select("subcontractor_id")
        .eq("project_id", projectId),
    ]);

  const mentions: ActivityMention[] = [];
  const project = projectResult.data;
  if (project) {
    mentions.push({
      id: project.id,
      type: "job",
      label: project.name,
      detail: project.project_number || "Selected job",
      token: mentionToken(project.project_number || project.name),
    });
  }

  const employees = employeesResult.data ?? [];
  const firstNameCounts = new Map<string, number>();
  for (const employee of employees) {
    const key = employee.first_name.toLowerCase();
    firstNameCounts.set(key, (firstNameCounts.get(key) ?? 0) + 1);
  }
  for (const employee of employees) {
    const fullName = `${employee.first_name} ${employee.last_name}`.trim();
    const uniqueFirstName = firstNameCounts.get(employee.first_name.toLowerCase()) === 1;
    mentions.push({
      id: employee.id,
      type: "worker",
      label: fullName,
      detail: employee.title || "Worker",
      token: mentionToken(uniqueFirstName ? employee.first_name : fullName),
    });
  }

  const assignedIds = new Set(
    (assignmentsResult.data ?? []).map((assignment) => assignment.subcontractor_id),
  );
  const subcontractors = [...(subcontractorsResult.data ?? [])].sort((a, b) => {
    const assignedDifference = Number(assignedIds.has(b.id)) - Number(assignedIds.has(a.id));
    return assignedDifference || a.company_name.localeCompare(b.company_name);
  });
  for (const subcontractor of subcontractors) {
    const trade = subcontractor.trades?.[0] || "Subcontractor";
    mentions.push({
      id: subcontractor.id,
      type: "subcontractor",
      label: subcontractor.company_name,
      detail: assignedIds.has(subcontractor.id) ? `${trade} · On this job` : trade,
      token: mentionToken(subcontractor.company_name),
    });
  }

  return mentions.filter((mention) => mention.token.length > 0);
}
