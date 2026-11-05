import "server-only";
import { getUser } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";
import { normalizeSiteCode } from "@/lib/sub-portal/site-code";
import { isInternalJob } from "@/lib/crew/crew-visibility";
import type { FolderJob } from "@/components/crew/crew-job-folder";

const TEAM_ROLES = ["owner", "precon_manager", "project_manager", "office_admin", "field"];

/** A scan reads the signed-in user's project; it never joins a job or changes a shift. */
export async function getTeamSiteJob(code: string): Promise<
  | { kind: "signed_out" }
  | { kind: "unavailable" }
  | { kind: "ready"; job: FolderJob; backHref: string }
> {
  const user = await getUser();
  if (!user) return { kind: "signed_out" };
  const role = user.profile?.role;
  if (!role || !TEAM_ROLES.includes(role)) return { kind: "unavailable" };
  const normalized = normalizeSiteCode(code);
  if (normalized.length !== 8) return { kind: "unavailable" };

  // Session client preserves project RLS. Do not use the public sub API's
  // service client to expand what a team account is allowed to see.
  const supabase = await createClient();
  const { data: project, error } = await supabase
    .from("projects")
    .select("id, name, project_number, is_overhead, address, city, state, zip, latitude, longitude, scope_of_work")
    .eq("site_code", normalized)
    .maybeSingle();
  if (error || !project || (role === "field" && isInternalJob(project))) return { kind: "unavailable" };

  return {
    kind: "ready",
    backHref: role === "field" ? "/crew" : `/projects/${project.id}`,
    job: {
      id: project.id,
      name: project.name,
      project_number: project.project_number ?? null,
      address: project.address ?? null,
      city: project.city ?? null,
      state: project.state ?? null,
      zip: project.zip ?? null,
      latitude: project.latitude ?? null,
      longitude: project.longitude ?? null,
      scope_of_work: project.scope_of_work ?? null,
      doc_count: 0,
      last_worked_at: null,
      today_task: null,
      clocked_in: false,
    },
  };
}
