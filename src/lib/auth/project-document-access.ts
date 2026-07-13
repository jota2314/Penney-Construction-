import type { UserRole } from "@/types/auth";

/**
 * Project documents can contain subcontractor pricing and internal job photos.
 * Keep this list explicit so adding a new office role does not grant access by
 * accident.
 *
 * `office_admin` is included so project managers who hold that role (e.g. Bill
 * Crowley) can see project files and quotes. Note this grants the same access
 * to every office_admin (e.g. admin staff handling permits/deposits).
 */
export const PROJECT_DOCUMENT_ROLES: readonly UserRole[] = [
  "owner",
  "precon_manager",
  "project_manager",
  "office_admin",
];

export function canManageProjectDocuments(
  role: UserRole | null | undefined,
): boolean {
  return role != null && PROJECT_DOCUMENT_ROLES.includes(role);
}
