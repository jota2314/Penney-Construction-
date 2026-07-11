import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserProfile } from "@/types/auth";
import { isProjectScopedRole } from "./role-access";

/**
 * Returns the set of project ids a project-scoped user (PM) may see:
 * projects where they are the assigned PM, plus projects they are
 * crew-assigned to via their linked employee record. Returns null for
 * unrestricted roles (owner, precon, admin) — callers skip filtering.
 */
export async function getScopedProjectIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  profile: UserProfile | null,
): Promise<Set<string> | null> {
  if (!profile || !isProjectScopedRole(profile.role)) return null;

  const ids = new Set<string>();

  const { data: pmProjects } = await supabase
    .from("projects")
    .select("id")
    .eq("assigned_pm", profile.id);
  for (const p of pmProjects ?? []) ids.add(p.id);

  // Employee record linked by profile_id, falling back to email — the
  // sign-up trigger historically only linked field workers.
  const { data: byProfile } = await supabase
    .from("employees")
    .select("id")
    .eq("profile_id", profile.id);
  let employeeIds = (byProfile ?? []).map((e) => e.id);
  if (!employeeIds.length && profile.email) {
    const { data: byEmail } = await supabase
      .from("employees")
      .select("id")
      .ilike("email", profile.email);
    employeeIds = (byEmail ?? []).map((e) => e.id);
  }

  if (employeeIds.length) {
    const { data: assignments } = await supabase
      .from("crew_project_assignments")
      .select("project_id")
      .in("employee_id", employeeIds);
    for (const a of assignments ?? []) ids.add(a.project_id);
  }

  return ids;
}
