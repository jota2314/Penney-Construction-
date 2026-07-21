"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { fetchTimeEntriesCompat } from "@/lib/crew/time-entries-compat";
import { getRateVisibility } from "@/lib/auth/rate-visibility";
import type { UserRole } from "@/types/auth";
import type {
  TeamMember,
  TeamMemberDashboard,
  TeamMemberCustomProfile,
  CreateTeamMemberInput,
  UpdateTeamMemberInput,
  UpsertCustomProfileInput,
  Certification,
  EmergencyContact,
} from "./team-types";

function isTestEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return /betancurfx/i.test(email);
}

// Postgres numeric comes back as a string from supabase-js. Coerce to a JS
// number so downstream formatting (.toFixed) doesn't throw.
function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function getTeamMembers(): Promise<TeamMember[]> {
  const supabase = await createClient();

  const [profilesRes, invitesRes, employeesRes] = await Promise.all([
    supabase.from("profiles").select("*").order("role").order("full_name"),
    supabase.from("team_invites").select("*").order("full_name"),
    supabase.from("employees").select("*").eq("status", "active").order("first_name"),
  ]);

  const profiles = profilesRes.data ?? [];
  const invites = invitesRes.data ?? [];
  const employees = employeesRes.data ?? [];

  const profileByEmail = new Map<string, (typeof profiles)[number]>();
  for (const p of profiles) {
    if (p.email) profileByEmail.set(p.email.toLowerCase(), p);
  }
  const employeeByEmail = new Map<string, (typeof employees)[number]>();
  const employeeByProfileId = new Map<string, (typeof employees)[number]>();
  for (const e of employees) {
    if (e.email) employeeByEmail.set(e.email.toLowerCase(), e);
    if (e.profile_id) employeeByProfileId.set(e.profile_id, e);
  }

  const members: TeamMember[] = [];
  const seenEmployeeIds = new Set<string>();

  // 1. Claimed profiles. A profile with role='field' is a field worker who
  // has signed in — bucket them as field, not office.
  for (const p of profiles) {
    if (isTestEmail(p.email)) continue;
    const linkedEmployee =
      employeeByProfileId.get(p.id) ||
      (p.email ? employeeByEmail.get(p.email.toLowerCase()) : undefined);
    if (linkedEmployee) seenEmployeeIds.add(linkedEmployee.id);

    const isField = p.role === "field";

    members.push({
      id: p.id,
      kind: isField ? "field" : "office",
      email: p.email,
      full_name: linkedEmployee
        ? `${linkedEmployee.first_name} ${linkedEmployee.last_name}`.trim() ||
          p.full_name ||
          p.email ||
          "Unknown"
        : p.full_name || p.email || "Unknown",
      role: (p.role as UserRole) ?? null,
      avatar_url: p.avatar_url,
      phone: p.phone ?? linkedEmployee?.phone ?? null,
      title: linkedEmployee?.title ?? null,
      hourly_rate: toNum(linkedEmployee?.hourly_rate),
      hire_date: linkedEmployee?.hire_date ?? null,
      auth_claimed: true,
      profile_id: p.id,
      employee_id: linkedEmployee?.id ?? null,
      is_pending_invite: false,
    });
  }

  // 2. Pending office invites
  for (const inv of invites) {
    if (isTestEmail(inv.email)) continue;
    const linkedEmployee = inv.email ? employeeByEmail.get(inv.email.toLowerCase()) : undefined;
    if (linkedEmployee) seenEmployeeIds.add(linkedEmployee.id);

    members.push({
      id: `invite:${inv.id}`,
      kind: "office",
      email: inv.email,
      full_name: inv.full_name,
      role: (inv.role as UserRole) ?? null,
      avatar_url: null,
      phone: inv.phone ?? linkedEmployee?.phone ?? null,
      title: linkedEmployee?.title ?? null,
      hourly_rate: toNum(linkedEmployee?.hourly_rate),
      hire_date: linkedEmployee?.hire_date ?? null,
      auth_claimed: false,
      profile_id: null,
      employee_id: linkedEmployee?.id ?? null,
      is_pending_invite: true,
    });
  }

  // 3. Field-only employees (no matching profile + no matching invite)
  for (const e of employees) {
    if (seenEmployeeIds.has(e.id)) continue;
    if (isTestEmail(e.email)) continue;

    members.push({
      id: `employee:${e.id}`,
      kind: "field",
      email: e.email,
      full_name: `${e.first_name} ${e.last_name}`.trim(),
      role: null,
      avatar_url: null,
      phone: e.phone,
      title: e.title,
      hourly_rate: toNum(e.hourly_rate),
      hire_date: e.hire_date,
      auth_claimed: !!e.profile_id,
      profile_id: e.profile_id,
      employee_id: e.id,
      is_pending_invite: !e.profile_id,
    });
  }

  // Office-team pay is restricted: only owners + precon see it, everyone
  // sees their own. Field rows stay visible.
  const vis = await getRateVisibility();
  if (!vis.viewAll) {
    for (const m of members) {
      if (m.kind !== "office") continue;
      const isSelf =
        (!!m.profile_id && m.profile_id === vis.selfProfileId) ||
        (!!m.employee_id && m.employee_id === vis.selfEmployeeId);
      if (!isSelf) m.hourly_rate = null;
    }
  }

  return members;
}

export async function getTeamMember(id: string): Promise<TeamMember | null> {
  const all = await getTeamMembers();
  const exact = all.find((m) => m.id === id);
  if (exact) return exact;
  // Also accept bare profile_id or employee_id
  return (
    all.find((m) => m.profile_id === id || m.employee_id === id) ?? null
  );
}

export async function getTeamMemberDashboard(id: string): Promise<TeamMemberDashboard | null> {
  const member = await getTeamMember(id);
  if (!member) return null;
  const supabase = await createClient();

  const dashboard: TeamMemberDashboard = { member };

  if (member.profile_id) {
    const profileId = member.profile_id;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const safe = (builder: PromiseLike<any>) =>
      Promise.resolve(builder).catch(() => ({ data: null, count: null, error: true }));

    const [projectsRes, estimatesRes, todosRes] = await Promise.all([
      safe(
        supabase
          .from("projects")
          .select("id", { count: "exact", head: true })
          .in("status", ["lead", "estimating", "proposal_sent", "contracted", "in_progress"])
          .or(`assigned_pm.eq.${profileId},assigned_estimator.eq.${profileId},created_by.eq.${profileId}`)
      ),
      safe(
        supabase
          .from("estimates")
          .select("id", { count: "exact", head: true })
          .eq("created_by", profileId)
          .in("status", ["draft", "review"])
      ),
      safe(
        supabase
          .from("todos")
          .select("id", { count: "exact", head: true })
          .eq("status", "open")
          // `todos` has no `assigned_to` column (only created_by + a text
          // `assignee`), so the old `.or(assigned_to...)` filter errored out
          // and this count silently returned 0.
          .eq("created_by", profileId)
      ),
    ]);

    dashboard.office = {
      activeProjects: projectsRes.count ?? 0,
      pendingEstimates: estimatesRes.count ?? 0,
      openFollowUps: todosRes.count ?? 0,
    };
  }

  if (member.employee_id) {
    const employeeId = member.employee_id;
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    weekStart.setHours(0, 0, 0, 0);
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const safe = (builder: PromiseLike<any>) =>
      Promise.resolve(builder).catch(() => ({ data: null, count: null, error: true }));

    const [weekEntriesRes, assignmentsRes, recentEntriesRes] = await Promise.all([
      safe(
        fetchTimeEntriesCompat(supabase, {
          employeeId,
          since: weekStart.toISOString(),
        }).then((data) => ({ data }))
      ),
      safe(
        supabase
          .from("crew_project_assignments")
          .select("id", { count: "exact", head: true })
          .eq("employee_id", employeeId)
      ),
      safe(
        fetchTimeEntriesCompat(supabase, {
          employeeId,
          since: twoWeeksAgo.toISOString(),
        }).then((rows) => ({ count: rows.length }))
      ),
    ]);

    let minutesThisWeek = 0;
    for (const e of weekEntriesRes.data ?? []) {
      const end = e.clock_out ? new Date(e.clock_out).getTime() : Date.now();
      const ms = end - new Date(e.clock_in).getTime();
      minutesThisWeek += Math.max(0, Math.floor(ms / 60000) - (e.break_minutes || 0));
    }
    const hoursThisWeek = Math.round((minutesThisWeek / 60) * 10) / 10;

    dashboard.field = {
      hoursThisWeek,
      activeProjects: assignmentsRes.count ?? 0,
      timeEntriesLast14d: recentEntriesRes.count ?? 0,
      hourlyRate: member.hourly_rate,
      earningsThisWeek: member.hourly_rate ? Math.round(hoursThisWeek * member.hourly_rate * 100) / 100 : 0,
    };
  }

  // Custom profile (bio, trades, certifications, etc.) — single row keyed by
  // profile_id when the member has a profile, else employee_id.
  if (member.profile_id || member.employee_id) {
    const profileQuery = member.profile_id
      ? supabase.from("team_member_profile").select("*").eq("profile_id", member.profile_id).maybeSingle()
      : supabase.from("team_member_profile").select("*").eq("employee_id", member.employee_id!).maybeSingle();
    const { data: cp } = await profileQuery;
    if (cp) {
      dashboard.customProfile = {
        id: cp.id,
        profile_id: cp.profile_id,
        employee_id: cp.employee_id,
        bio: cp.bio,
        avatar_url: cp.avatar_url,
        pronouns: cp.pronouns,
        trades: cp.trades ?? [],
        certifications: (cp.certifications as Certification[] | null) ?? [],
        languages: cp.languages ?? [],
        years_experience: cp.years_experience,
        hire_date: cp.hire_date,
        emergency_contact: (cp.emergency_contact as EmergencyContact | null) ?? null,
        visible_to_clients: !!cp.visible_to_clients,
        updated_at: cp.updated_at,
      } satisfies TeamMemberCustomProfile;
    } else {
      dashboard.customProfile = null;
    }
  }

  return dashboard;
}

export async function upsertTeamMemberCustomProfile(
  memberId: string,
  fields: UpsertCustomProfileInput
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: ownProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  const isOwner = ownProfile?.role === "owner";

  const member = await getTeamMember(memberId);
  if (!member) return { error: "Team member not found" };

  const isSelf = member.profile_id === user.id;
  if (!isOwner && !isSelf) return { error: "Forbidden" };
  if (!member.profile_id && !member.employee_id) {
    return { error: "Cannot save custom profile for this member" };
  }

  // Build the row payload. Only include keys that were actually provided so
  // that an edit form can save partial updates without clobbering other fields.
  const row: Record<string, unknown> = {};
  if (fields.bio !== undefined) row.bio = fields.bio;
  if (fields.pronouns !== undefined) row.pronouns = fields.pronouns;
  if (fields.trades !== undefined) row.trades = fields.trades;
  if (fields.certifications !== undefined) row.certifications = fields.certifications;
  if (fields.languages !== undefined) row.languages = fields.languages;
  if (fields.years_experience !== undefined) row.years_experience = fields.years_experience;
  if (fields.hire_date !== undefined) row.hire_date = fields.hire_date;
  if (fields.emergency_contact !== undefined) row.emergency_contact = fields.emergency_contact;
  if (fields.visible_to_clients !== undefined) row.visible_to_clients = fields.visible_to_clients;
  row.updated_by = user.id;

  // Find or create the row keyed on profile_id (preferred) or employee_id.
  const lookup = member.profile_id
    ? { profile_id: member.profile_id }
    : { employee_id: member.employee_id! };

  const { data: existing } = await supabase
    .from("team_member_profile")
    .select("id")
    .match(lookup)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("team_member_profile")
      .update(row)
      .eq("id", existing.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase
      .from("team_member_profile")
      .insert({ ...lookup, ...row });
    if (error) return { error: error.message };
  }

  revalidatePath("/team");
  revalidatePath(`/team/${memberId}`);
  return { success: true };
}

async function requireOwner() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, isOwner: false, error: "Not authenticated" as const };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  return {
    supabase,
    user,
    isOwner: profile?.role === "owner",
    error: profile?.role === "owner" ? null : ("Only owners can perform this action" as const),
  };
}

export async function createTeamMember(input: CreateTeamMemberInput) {
  const { supabase, user, isOwner, error } = await requireOwner();
  if (!isOwner || !user) return { error: error ?? "Forbidden" };

  const email = input.email.toLowerCase().trim();
  const fullName = input.full_name.trim();
  if (!email || !fullName) return { error: "Email and name are required" };

  if (input.kind === "office") {
    const role = input.role ?? "project_manager";
    const { error: existsErr } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (existsErr && existsErr.code !== "PGRST116") {
      return { error: existsErr.message };
    }

    const { error: inviteErr } = await supabase.from("team_invites").upsert(
      {
        email,
        full_name: fullName,
        role,
        phone: input.phone ?? null,
        invited_by: user.id,
      },
      { onConflict: "email" }
    );
    if (inviteErr) return { error: inviteErr.message };
  } else {
    // Field: create/update employee + add to allowed_emails
    const [firstName, ...rest] = fullName.split(/\s+/);
    const lastName = rest.join(" ") || "";

    const { error: allowedErr } = await supabase.from("allowed_emails").upsert(
      { email, role: "field", invited_by: user.id },
      { onConflict: "email" }
    );
    if (allowedErr) return { error: allowedErr.message };

    const { data: existing } = await supabase
      .from("employees")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (existing) {
      await supabase
        .from("employees")
        .update({
          first_name: firstName,
          last_name: lastName,
          title: input.title ?? null,
          hourly_rate: input.hourly_rate ?? null,
          phone: input.phone ?? null,
          status: "active",
        })
        .eq("id", existing.id);
    } else {
      await supabase.from("employees").insert({
        first_name: firstName,
        last_name: lastName,
        email,
        title: input.title ?? null,
        hourly_rate: input.hourly_rate ?? null,
        phone: input.phone ?? null,
        status: "active",
        created_by: user.id,
      });
    }
  }

  revalidatePath("/team");
  return { success: true };
}

export async function updateTeamMember(id: string, fields: UpdateTeamMemberInput) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: ownProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  const isOwner = ownProfile?.role === "owner";

  const member = await getTeamMember(id);
  if (!member) return { error: "Team member not found" };

  const isSelf = member.profile_id === user.id;
  if (!isOwner && !isSelf) return { error: "Forbidden" };

  const profileFields: Record<string, unknown> = {};
  if (fields.full_name !== undefined) profileFields.full_name = fields.full_name;
  if (fields.phone !== undefined) profileFields.phone = fields.phone;
  if (isOwner && fields.role !== undefined) profileFields.role = fields.role;

  const employeeFields: Record<string, unknown> = {};
  if (fields.phone !== undefined) employeeFields.phone = fields.phone;
  if (fields.full_name !== undefined) {
    const [firstName, ...rest] = fields.full_name.trim().split(/\s+/);
    employeeFields.first_name = firstName;
    employeeFields.last_name = rest.join(" ") || "";
  }
  if (isOwner && fields.title !== undefined) employeeFields.title = fields.title;
  if (isOwner && fields.hourly_rate !== undefined) employeeFields.hourly_rate = fields.hourly_rate;
  if (isOwner && fields.email !== undefined) employeeFields.email = fields.email.toLowerCase().trim();

  if (member.profile_id && Object.keys(profileFields).length) {
    const { error } = await supabase
      .from("profiles")
      .update(profileFields)
      .eq("id", member.profile_id);
    if (error) return { error: error.message };
  }

  if (member.employee_id && Object.keys(employeeFields).length) {
    const { error } = await supabase
      .from("employees")
      .update(employeeFields)
      .eq("id", member.employee_id);
    if (error) return { error: error.message };
  }

  // Also update pending invite if applicable
  if (member.is_pending_invite && !member.profile_id && id.startsWith("invite:")) {
    const inviteId = id.slice("invite:".length);
    const inviteFields: Record<string, unknown> = {};
    if (fields.full_name !== undefined) inviteFields.full_name = fields.full_name;
    if (fields.phone !== undefined) inviteFields.phone = fields.phone;
    if (isOwner && fields.role !== undefined) inviteFields.role = fields.role;
    if (isOwner && fields.email !== undefined) inviteFields.email = fields.email.toLowerCase().trim();
    if (Object.keys(inviteFields).length) {
      const { error } = await supabase
        .from("team_invites")
        .update(inviteFields)
        .eq("id", inviteId);
      if (error) return { error: error.message };
    }
  }

  revalidatePath("/team");
  revalidatePath(`/team/${id}`);
  return { success: true };
}

export async function deleteTeamMember(id: string) {
  const { supabase, isOwner, error } = await requireOwner();
  if (!isOwner) return { error: error ?? "Forbidden" };

  const member = await getTeamMember(id);
  if (!member) return { error: "Team member not found" };

  if (id.startsWith("invite:")) {
    const inviteId = id.slice("invite:".length);
    const { error: delErr } = await supabase.from("team_invites").delete().eq("id", inviteId);
    if (delErr) return { error: delErr.message };
  } else if (member.employee_id && !member.profile_id) {
    // Soft-delete: mark inactive rather than hard delete (preserves time_entries)
    const { error: updateErr } = await supabase
      .from("employees")
      .update({ status: "inactive" })
      .eq("id", member.employee_id);
    if (updateErr) return { error: updateErr.message };
  } else {
    return { error: "Claimed profiles cannot be deleted from the UI — contact an admin" };
  }

  revalidatePath("/team");
  return { success: true };
}
