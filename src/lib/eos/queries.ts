/**
 * Server-side EOS reads. Deliberately NOT a `"use server"` module —
 * `getEosContext` hands back a live Supabase client, which cannot cross
 * the server-action serialization boundary. Mutations live in
 * `src/lib/actions/eos-*.ts`.
 */
import { getUser } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";
import { currentQuarter, recentWeeks, weekEnding } from "@/lib/constants/eos";
import type {
  EosAttendee,
  EosHeadline,
  EosIssue,
  EosMeasurable,
  EosMeeting,
  EosPerson,
  EosRock,
  EosSeat,
  EosTeam,
  EosTodo,
  EosVto,
} from "@/types/eos";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export interface EosContext {
  supabase: SupabaseServerClient;
  team: EosTeam;
  /** Profile id of the signed-in user. */
  viewerId: string;
  /** Everyone seated on the team, for owner pickers. */
  people: EosPerson[];
}

/**
 * EOS is leadership-only. Access means holding a seat on an EOS team —
 * app role is the wrong test here (Howie runs Operations but carries the
 * `field` role, and every carpenter carries it too).
 *
 * Returns null rather than redirecting so callers can decide: pages
 * redirect, the nav just hides the item.
 */
export async function getEosContext(): Promise<EosContext | null> {
  const user = await getUser();
  const viewerId = user?.profile?.id ?? user?.id;
  if (!viewerId) return null;

  const supabase = await createClient();

  const { data: membership } = await supabase
    .from("eos_team_members")
    .select("team_id, eos_teams!inner(id, name, is_leadership, meeting_day, meeting_time)")
    .eq("profile_id", viewerId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const teamRow = membership?.eos_teams as
    | {
        id: string;
        name: string;
        is_leadership: boolean;
        meeting_day: number | null;
        meeting_time: string | null;
      }
    | undefined;

  if (!teamRow) return null;

  const { data: memberRows } = await supabase
    .from("eos_team_members")
    .select("seat_label, profiles!inner(id, full_name, email)")
    .eq("team_id", teamRow.id);

  // Jorge holds two profiles (work + personal Google). Both are seated so
  // he can get in from either, but the owner picker must show him once.
  const seen = new Set<string>();
  const people: EosPerson[] = [];
  for (const row of memberRows ?? []) {
    const profile = row.profiles as unknown as {
      id: string;
      full_name: string | null;
      email: string;
    };
    const name = profile.full_name ?? profile.email;
    if (seen.has(name)) continue;
    seen.add(name);
    people.push({
      id: profile.id,
      name,
      email: profile.email,
      seatLabel: row.seat_label,
    });
  }
  people.sort((a, b) => a.name.localeCompare(b.name));

  return {
    supabase,
    viewerId,
    people,
    team: {
      id: teamRow.id,
      name: teamRow.name,
      isLeadership: teamRow.is_leadership,
      meetingDay: teamRow.meeting_day,
      meetingTime: teamRow.meeting_time,
    },
  };
}

function personName(
  profile: { full_name: string | null; email: string } | null | undefined,
): string | null {
  if (!profile) return null;
  return profile.full_name ?? profile.email;
}

// ── Rocks ───────────────────────────────────────────────────────

export async function listRocks(
  ctx: EosContext,
  quarter = currentQuarter(),
): Promise<EosRock[]> {
  const { data } = await ctx.supabase
    .from("eos_rocks")
    .select(
      `id, title, description, owner_profile_id, type, quarter, due_date,
       status, sort_order,
       profiles:owner_profile_id (full_name, email),
       eos_rock_milestones (id, rock_id, title, due_date, is_done, sort_order)`,
    )
    .eq("team_id", ctx.team.id)
    .eq("quarter", quarter)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    ownerId: row.owner_profile_id,
    ownerName: personName(row.profiles as never),
    type: row.type,
    quarter: row.quarter,
    dueDate: row.due_date,
    status: row.status,
    sortOrder: row.sort_order,
    milestones: ((row.eos_rock_milestones ?? []) as never[])
      .map((m: never) => {
        const milestone = m as unknown as {
          id: string;
          rock_id: string;
          title: string;
          due_date: string | null;
          is_done: boolean;
          sort_order: number;
        };
        return {
          id: milestone.id,
          rockId: milestone.rock_id,
          title: milestone.title,
          dueDate: milestone.due_date,
          isDone: milestone.is_done,
          sortOrder: milestone.sort_order,
        };
      })
      .sort((a, b) => a.sortOrder - b.sortOrder),
  }));
}

export async function listRockQuarters(ctx: EosContext): Promise<string[]> {
  const { data } = await ctx.supabase
    .from("eos_rocks")
    .select("quarter")
    .eq("team_id", ctx.team.id);

  const quarters = new Set((data ?? []).map((r) => r.quarter as string));
  quarters.add(currentQuarter());

  // "Q3 2026" → sort by year then quarter, newest first.
  return Array.from(quarters).sort((a, b) => {
    const [aq, ay] = a.split(" ");
    const [bq, by] = b.split(" ");
    return by.localeCompare(ay) || bq.localeCompare(aq);
  });
}

// ── Scorecard ───────────────────────────────────────────────────

export async function listMeasurables(
  ctx: EosContext,
  weeks = recentWeeks(13),
): Promise<EosMeasurable[]> {
  const { data } = await ctx.supabase
    .from("eos_measurables")
    .select(
      `id, name, description, owner_profile_id, unit, goal_target, comparison,
       cadence, sort_order,
       profiles:owner_profile_id (full_name, email),
       eos_scores (week_ending, value)`,
    )
    .eq("team_id", ctx.team.id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  const windowStart = weeks[0];
  const windowEnd = weeks[weeks.length - 1];

  return (data ?? []).map((row) => {
    const scores: Record<string, number | null> = {};
    for (const s of (row.eos_scores ?? []) as unknown as {
      week_ending: string;
      value: number | null;
    }[]) {
      if (s.week_ending < windowStart || s.week_ending > windowEnd) continue;
      scores[s.week_ending] = s.value === null ? null : Number(s.value);
    }

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      ownerId: row.owner_profile_id,
      ownerName: personName(row.profiles as never),
      unit: row.unit,
      goalTarget: row.goal_target === null ? null : Number(row.goal_target),
      comparison: row.comparison,
      cadence: row.cadence,
      sortOrder: row.sort_order,
      scores,
    };
  });
}

// ── Issues ──────────────────────────────────────────────────────

export async function listIssues(
  ctx: EosContext,
  opts: { status?: EosIssue["status"] } = {},
): Promise<EosIssue[]> {
  let query = ctx.supabase
    .from("eos_issues")
    .select(
      `id, title, description, owner_profile_id, term, status, priority,
       solution, solved_at, source, created_at,
       profiles:owner_profile_id (full_name, email)`,
    )
    .eq("team_id", ctx.team.id);

  if (opts.status) query = query.eq("status", opts.status);

  const { data } = await query
    .order("priority", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    ownerId: row.owner_profile_id,
    ownerName: personName(row.profiles as never),
    term: row.term,
    status: row.status,
    priority: row.priority,
    solution: row.solution,
    solvedAt: row.solved_at,
    source: row.source,
    createdAt: row.created_at,
  }));
}

// ── To-dos ──────────────────────────────────────────────────────

export async function listTodos(
  ctx: EosContext,
  opts: { status?: EosTodo["status"] } = {},
): Promise<EosTodo[]> {
  let query = ctx.supabase
    .from("eos_todos")
    .select(
      `id, title, description, owner_profile_id, due_date, status,
       completed_at, meeting_id, created_at,
       profiles:owner_profile_id (full_name, email)`,
    )
    .eq("team_id", ctx.team.id);

  if (opts.status) query = query.eq("status", opts.status);

  const { data } = await query
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    ownerId: row.owner_profile_id,
    ownerName: personName(row.profiles as never),
    dueDate: row.due_date,
    status: row.status,
    completedAt: row.completed_at,
    meetingId: row.meeting_id,
    createdAt: row.created_at,
  }));
}

// ── Headlines ───────────────────────────────────────────────────

export async function listHeadlines(
  ctx: EosContext,
  meetingId?: string,
): Promise<EosHeadline[]> {
  let query = ctx.supabase
    .from("eos_headlines")
    .select("id, kind, body, meeting_id, created_at")
    .eq("team_id", ctx.team.id);

  if (meetingId) query = query.eq("meeting_id", meetingId);

  const { data } = await query.order("created_at", { ascending: true });

  return (data ?? []).map((row) => ({
    id: row.id,
    kind: row.kind,
    body: row.body,
    meetingId: row.meeting_id,
    createdAt: row.created_at,
  }));
}

// ── Meetings ────────────────────────────────────────────────────

function mapMeeting(row: Record<string, unknown>): EosMeeting {
  return {
    id: row.id as string,
    teamId: row.team_id as string,
    meetingDate: row.meeting_date as string,
    status: row.status as EosMeeting["status"],
    startedAt: (row.started_at as string) ?? null,
    endedAt: (row.ended_at as string) ?? null,
    currentSection: (row.current_section as string) ?? null,
    sectionStartedAt: (row.section_started_at as string) ?? null,
    sectionLog: (row.section_log as EosMeeting["sectionLog"]) ?? [],
    cascadingMessage: (row.cascading_message as string) ?? null,
    notes: (row.notes as string) ?? null,
    avgRating: row.avg_rating === null ? null : Number(row.avg_rating),
  };
}

const MEETING_COLUMNS = `id, team_id, meeting_date, status, started_at, ended_at,
  current_section, section_started_at, section_log, cascading_message, notes,
  avg_rating`;

export async function listMeetings(ctx: EosContext, limit = 26): Promise<EosMeeting[]> {
  const { data } = await ctx.supabase
    .from("eos_meetings")
    .select(MEETING_COLUMNS)
    .eq("team_id", ctx.team.id)
    .order("meeting_date", { ascending: false })
    .limit(limit);

  return (data ?? []).map(mapMeeting);
}

export async function getMeeting(
  ctx: EosContext,
  meetingId: string,
): Promise<EosMeeting | null> {
  const { data } = await ctx.supabase
    .from("eos_meetings")
    .select(MEETING_COLUMNS)
    .eq("id", meetingId)
    .eq("team_id", ctx.team.id)
    .maybeSingle();

  return data ? mapMeeting(data) : null;
}

/** The meeting currently running, if someone has one open. */
export async function getLiveMeeting(ctx: EosContext): Promise<EosMeeting | null> {
  const { data } = await ctx.supabase
    .from("eos_meetings")
    .select(MEETING_COLUMNS)
    .eq("team_id", ctx.team.id)
    .eq("status", "in_progress")
    .order("meeting_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data ? mapMeeting(data) : null;
}

export async function listAttendees(
  ctx: EosContext,
  meetingId: string,
): Promise<EosAttendee[]> {
  const { data } = await ctx.supabase
    .from("eos_meeting_attendees")
    .select(
      `profile_id, is_present, personal_best, business_best, rating,
       profiles!inner(id, full_name, email)`,
    )
    .eq("meeting_id", meetingId);

  const seatByProfile = new Map(ctx.people.map((p) => [p.id, p.seatLabel]));

  return (data ?? [])
    .map((row) => {
      const profile = row.profiles as unknown as {
        id: string;
        full_name: string | null;
        email: string;
      };
      return {
        profileId: row.profile_id,
        name: profile.full_name ?? profile.email,
        seatLabel: seatByProfile.get(row.profile_id) ?? null,
        isPresent: row.is_present,
        personalBest: row.personal_best,
        businessBest: row.business_best,
        rating: row.rating,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ── Accountability Chart ────────────────────────────────────────

export async function listSeats(ctx: EosContext): Promise<EosSeat[]> {
  const { data } = await ctx.supabase
    .from("eos_seats")
    .select("id, parent_id, name, holder_profile_id, holder_name, roles, sort_order")
    .eq("team_id", ctx.team.id)
    .order("sort_order", { ascending: true });

  const nameByProfile = new Map(ctx.people.map((p) => [p.id, p.name]));

  return (data ?? []).map((row) => ({
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    holderProfileId: row.holder_profile_id,
    holderName:
      row.holder_name ??
      (row.holder_profile_id ? nameByProfile.get(row.holder_profile_id) ?? null : null),
    roles: row.roles ?? [],
    sortOrder: row.sort_order,
  }));
}

// ── V/TO ────────────────────────────────────────────────────────

export async function getVto(ctx: EosContext): Promise<EosVto | null> {
  const { data } = await ctx.supabase
    .from("eos_vto")
    .select("*")
    .eq("team_id", ctx.team.id)
    .maybeSingle();

  if (!data) return null;

  return {
    teamId: data.team_id,
    coreValues: (data.core_values ?? []) as EosVto["coreValues"],
    purpose: data.purpose,
    niche: data.niche,
    tenYearTarget: data.ten_year_target,
    targetMarket: data.target_market,
    threeUniques: (data.three_uniques ?? []) as string[],
    provenProcess: data.proven_process,
    guarantee: data.guarantee,
    threeYearDate: data.three_year_date,
    threeYearRevenue: data.three_year_revenue === null ? null : Number(data.three_year_revenue),
    threeYearProfit: data.three_year_profit === null ? null : Number(data.three_year_profit),
    threeYearMeasurables: data.three_year_measurables,
    threeYearPicture: (data.three_year_picture ?? []) as string[],
    oneYearDate: data.one_year_date,
    oneYearRevenue: data.one_year_revenue === null ? null : Number(data.one_year_revenue),
    oneYearProfit: data.one_year_profit === null ? null : Number(data.one_year_profit),
    oneYearMeasurables: data.one_year_measurables,
    oneYearGoals: (data.one_year_goals ?? []) as string[],
  };
}

// ── Overview ────────────────────────────────────────────────────

export interface EosOverview {
  quarter: string;
  rocks: EosRock[];
  measurables: EosMeasurable[];
  openIssues: number;
  openTodos: number;
  overdueTodos: number;
  liveMeeting: EosMeeting | null;
  lastMeeting: EosMeeting | null;
  thisWeek: string;
}

export async function getEosOverview(ctx: EosContext): Promise<EosOverview> {
  const thisWeek = weekEnding();
  const [rocks, measurables, issues, todos, meetings, liveMeeting] = await Promise.all([
    listRocks(ctx),
    listMeasurables(ctx, recentWeeks(5)),
    listIssues(ctx, { status: "open" }),
    listTodos(ctx, { status: "open" }),
    listMeetings(ctx, 5),
    getLiveMeeting(ctx),
  ]);

  const today = new Date().toISOString().slice(0, 10);

  return {
    quarter: currentQuarter(),
    rocks,
    measurables,
    openIssues: issues.length,
    openTodos: todos.length,
    overdueTodos: todos.filter((t) => t.dueDate && t.dueDate < today).length,
    liveMeeting,
    lastMeeting: meetings.find((m) => m.status === "completed") ?? null,
    thisWeek,
  };
}
