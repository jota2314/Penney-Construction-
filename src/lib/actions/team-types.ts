import type { UserRole } from "@/types/auth";

export type TeamMemberKind = "office" | "field";

export interface TeamMember {
  id: string;
  kind: TeamMemberKind;
  email: string | null;
  full_name: string;
  role: UserRole | null;
  avatar_url: string | null;
  phone: string | null;
  title: string | null;
  hourly_rate: number | null;
  hire_date: string | null;
  auth_claimed: boolean;
  profile_id: string | null;
  employee_id: string | null;
  is_pending_invite: boolean;
}

export interface TeamMemberDashboard {
  member: TeamMember;
  office?: {
    activeProjects: number;
    pendingEstimates: number;
    openFollowUps: number;
    recentQuotes: number;
  };
  field?: {
    hoursThisWeek: number;
    activeProjects: number;
    timeEntriesLast14d: number;
    hourlyRate: number | null;
    earningsThisWeek: number;
  };
  customProfile?: TeamMemberCustomProfile | null;
}

export interface Certification {
  name: string;
  issuer?: string | null;
  expires?: string | null; // YYYY-MM-DD
}

export interface EmergencyContact {
  name: string;
  phone?: string | null;
  relationship?: string | null;
}

export interface TeamMemberCustomProfile {
  id: string;
  profile_id: string | null;
  employee_id: string | null;
  bio: string | null;
  avatar_url: string | null;
  pronouns: string | null;
  trades: string[];
  certifications: Certification[];
  languages: string[];
  years_experience: number | null;
  hire_date: string | null;
  emergency_contact: EmergencyContact | null;
  visible_to_clients: boolean;
  updated_at: string;
}

export interface UpsertCustomProfileInput {
  bio?: string | null;
  pronouns?: string | null;
  trades?: string[];
  certifications?: Certification[];
  languages?: string[];
  years_experience?: number | null;
  hire_date?: string | null;
  emergency_contact?: EmergencyContact | null;
  visible_to_clients?: boolean;
}

export interface CreateTeamMemberInput {
  kind: TeamMemberKind;
  email: string;
  full_name: string;
  role?: UserRole;
  phone?: string;
  title?: string;
  hourly_rate?: number;
}

export interface UpdateTeamMemberInput {
  full_name?: string;
  role?: UserRole;
  phone?: string | null;
  title?: string | null;
  hourly_rate?: number | null;
  email?: string;
}
