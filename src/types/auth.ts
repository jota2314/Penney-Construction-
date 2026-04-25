export type UserRole = "owner" | "precon_manager" | "project_manager" | "office_admin" | "field";

export type AppMode = "precon" | "construction";

export interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  role: UserRole;
  phone: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuthUser {
  id: string;
  email: string;
  profile: UserProfile | null;
  isImpersonating?: boolean;
  realProfile?: UserProfile | null;
}
