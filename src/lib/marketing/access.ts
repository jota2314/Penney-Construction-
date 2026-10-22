const MARKETING_ROLES = new Set(["owner", "office_admin", "precon_manager", "project_manager"]);

export function canManageMarketing(role: string | null | undefined): boolean {
  return typeof role === "string" && MARKETING_ROLES.has(role);
}
