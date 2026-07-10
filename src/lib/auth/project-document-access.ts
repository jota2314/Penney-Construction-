import type { UserRole } from "@/types/auth";

/**
 * Project documents can contain subcontractor pricing and internal job photos.
 * Keep this list explicit so adding a new office role does not grant access by
 * accident.
 */
export const PROJECT_DOCUMENT_ROLES: readonly UserRole[] = [
  "owner",
  "precon_manager",
  "project_manager",
];

export function canManageProjectDocuments(
  role: UserRole | null | undefined,
): boolean {
  return role != null && PROJECT_DOCUMENT_ROLES.includes(role);
}
