/** Assignments identify job responsibility; they do not grant a business role. */
export function canAssignProjectManager(role: string | null | undefined): boolean {
  return !!role && ["owner", "precon_manager", "project_manager", "office_admin"].includes(role);
}

export function canBeProjectManager(role: string | null | undefined): boolean {
  return !!role && ["owner", "precon_manager", "project_manager"].includes(role);
}
