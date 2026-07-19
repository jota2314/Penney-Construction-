"use server";

import { createClient } from "@/lib/supabase/server";

export type ActivityMention = {
  id: string;
  type: "job" | "worker" | "subcontractor";
  label: string;
  detail: string;
  token: string;
  profileId: string | null;
};

function mentionToken(value: string): string {
  const parts = value
    .trim()
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  return parts.map((part) => part[0]?.toUpperCase() + part.slice(1)).join("");
}

/**
 * Mention choices for activity posts. With a project id, that job and its
 * assigned subcontractors sort first. Without one, all active jobs are
 * available for a general company post.
 */
export async function listActivityMentions(projectId?: string): Promise<ActivityMention[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  let projectsQuery = supabase
    .from("projects")
    .select("id, name, project_number, status")
    .order("updated_at", { ascending: false })
    .limit(100);
  projectsQuery = projectId
    ? projectsQuery.eq("id", projectId)
    : projectsQuery.in("status", ["lead", "estimating", "proposal_sent", "contracted", "in_progress"]);

  const [projectsResult, employeesResult, profilesResult, subcontractorsResult, assignmentsResult] =
    await Promise.all([
      projectsQuery,
      supabase
        .from("employees")
        .select("id, first_name, last_name, email, title, profile_id")
        .eq("status", "active")
        .order("first_name", { ascending: true }),
      supabase.from("profiles").select("id, email"),
      supabase
        .from("subcontractors")
        .select("id, company_name, contact_name, trades")
        .eq("is_active", true)
        .order("company_name", { ascending: true })
        .limit(200),
      projectId
        ? supabase
            .from("project_subcontractors")
            .select("subcontractor_id")
            .eq("project_id", projectId)
        : Promise.resolve({ data: [] as { subcontractor_id: string }[] }),
    ]);

  const mentions: ActivityMention[] = [];
  for (const project of projectsResult.data ?? []) {
    mentions.push({
      id: project.id,
      type: "job",
      label: project.name,
      detail: project.project_number || "Selected job",
      token: mentionToken(project.project_number || project.name),
      profileId: null,
    });
  }

  // Some employee rows were created without a profile_id link even though the
  // person has an account — resolve by email as a fallback so tagging them
  // still notifies (a tag with profileId=null pings nobody).
  const profileIdByEmail = new Map<string, string>();
  for (const profile of profilesResult.data ?? []) {
    if (profile.email) profileIdByEmail.set(profile.email.toLowerCase(), profile.id);
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
      profileId:
        employee.profile_id ??
        (employee.email ? profileIdByEmail.get(employee.email.toLowerCase()) ?? null : null),
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
      profileId: null,
    });
  }

  return mentions.filter((mention) => mention.token.length > 0);
}
