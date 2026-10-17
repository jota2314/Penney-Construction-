"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/auth/get-user";
import { canViewJobBoard } from "@/lib/auth/role-access";
import { setPhaseConfirmation, updateSchedulePhase } from "@/lib/actions/schedule";
import { setCrewAssignment } from "@/lib/actions/crew-board";
import { isInternalJob } from "@/lib/crew/crew-visibility";
import { isParkedPlanStep } from "@/lib/schedule/parked";
import { isMasterPhase } from "@/lib/schedule/progress";
import {
  NOBODY_DAYS,
  NOT_WORK_EVENTS,
  isOpenWorkPhase as isOpenWork,
  nobodyPhases,
  phaseHasPeople as hasPeople,
} from "@/lib/schedule/subs-needed-rule";
import {
  isNonInstallerSub,
  isNonInstallerTrade,
  isNonWorkPhaseName,
  normalizeTrade,
  subDoesTrade,
  tradeForPhaseName,
  tradeLabel,
} from "@/lib/schedule/trade-keywords";
import {
  aliasOfferFor,
  aliasProblem,
  loadSubDirectory,
  loadSuggestContext,
  subName,
  suggestSubsForPhase,
  type PhaseSuggestions,
  type SubDirectoryEntry,
  type SubSuggestion,
} from "@/lib/schedule/suggest-subs";
import { addDays, coversDay, etDayRange, etTimeLabel, todayET } from "@/lib/sub-portal/et-day";
import { SUB_LIVE_STATUSES } from "@/lib/sub-portal/statuses";

/**
 * Putting subs on the schedule — the root cause behind an empty sub portal.
 *
 * Nothing here assigns anyone on its own. The Subs needed sheet and the board
 * panel show who is missing and who probably belongs there; every save is an
 * office tap that goes through the schedule's own actions:
 *   - assigning → `updateSchedulePhase`, which emails "You're scheduled" to a
 *     newly added sub only when the phase is already confirmed (the UI says so
 *     before the tap),
 *   - Confirm & notify → `setPhaseConfirmation`, with its people + budget-line
 *     gate intact,
 *   - Put on today → the crew board's own day writer (`setCrewAssignment`):
 *     a daily, unconfirmed row with a client-safe trade name, so no email.
 *
 * Everything is worked out when read, so it also catches phases written by
 * the AI email engine, SQL rebuilds or any other writer that left subs off.
 */

type Db = Awaited<ReturnType<typeof createClient>>;

/** Penciled-in subs starting this soon should be confirmed. (NOBODY_DAYS and the work rule: lib/schedule/subs-needed-rule.ts, shared with the 5:30 digest.) */
const PENCILED_DAYS = 7;

async function officeUser() {
  const user = await getUser();
  if (!user) return { error: "Not signed in" as const };
  const viewer = { role: user.profile?.role, email: user.profile?.email ?? user.email };
  if (!canViewJobBoard(viewer)) return { error: "Not allowed" as const };
  return { userId: user.profile?.id ?? user.id, name: user.profile?.full_name?.trim() || user.email || "Office" };
}

// ── Shapes the sheet renders ────────────────────────────────────

export interface SubsNeededPerson {
  id: string;
  kind: "sub" | "employee";
  name: string;
  hasEmail: boolean;
}

export interface SubsNeededNobodyRow {
  phaseId: string;
  projectId: string;
  projectName: string;
  projectNumber: string | null;
  name: string;
  startDate: string;
  endDate: string;
  isConfirmed: boolean;
  phaseScope: string | null;
  hasLine: boolean;
  trade: string | null;
  tradeLabel: string | null;
  notesHint: PhaseSuggestions["notesHint"];
  suggestions: SubSuggestion[];
}

export interface SubsNeededPenciledRow {
  phaseId: string;
  projectId: string;
  projectName: string;
  name: string;
  startDate: string;
  endDate: string;
  hasLine: boolean;
  people: SubsNeededPerson[];
  /** What `setPhaseConfirmation` will say if pressed now; null = it will go through. */
  gate: string | null;
}

export interface SubsNeededUnscheduledRow {
  key: string;
  subId: string;
  subName: string;
  projectId: string;
  projectName: string;
  firstSeenAt: string | null;
  /** "7:12 AM" ET, or "" when only a post is known. */
  firstSeenLabel: string;
  posts: number;
  photos: number;
  checkedIn: boolean;
  /** The client-safe name "Put on today" will write: "Demolition". */
  scope: string;
}

export interface SubsNeededData {
  today: string;
  generatedAt: string;
  projectId: string | null;
  projectName: string | null;
  nobody: SubsNeededNobodyRow[];
  penciled: SubsNeededPenciledRow[];
  unscheduled: SubsNeededUnscheduledRow[];
  jobsWithNobody: number;
  /** Every active installer, for picking someone the chips didn't offer. */
  directory: { id: string; name: string; trades: string[]; hasEmail: boolean }[];
  error: string | null;
}

export interface SubsNeededSummary {
  nobody: number;
  jobsWithNobody: number;
  penciled: number;
  unscheduled: number;
  total: number;
}

interface PhaseRow {
  id: string;
  project_id: string;
  name: string;
  notes: string | null;
  start_date: string;
  end_date: string | null;
  status: string | null;
  event_type: string | null;
  phase_scope: string | null;
  is_confirmed: boolean | null;
  planned_start_date: string | null;
  is_manually_scheduled: boolean | null;
  assigned_employee_ids: string[] | null;
  assigned_sub_ids: string[] | null;
  estimate_line_item_id: string | null;
  master_phase_id: string | null;
}

interface ProjectRow {
  id: string;
  name: string;
  project_number: string | null;
  status: string;
  is_overhead: boolean | null;
}

const PHASE_COLUMNS =
  "id, project_id, name, notes, start_date, end_date, status, event_type, phase_scope, is_confirmed, planned_start_date, is_manually_scheduled, assigned_employee_ids, assigned_sub_ids, estimate_line_item_id, master_phase_id";

/** The client-safe name for a sub's unplanned day: today's matching phase trade, else his own trade. */
function scopeForSub(sub: SubDirectoryEntry | undefined, phasesToday: PhaseRow[]): { scope: string; masterPhaseId: string | null } {
  const matching = phasesToday.filter((p) => isOpenWork(p) && !hasPeople(p) && isMasterPhase(p) && subDoesTrade(sub?.trades, tradeForPhaseName(p.name)));
  if (matching.length) {
    return { scope: tradeLabel(tradeForPhaseName(matching[0].name)), masterPhaseId: matching.length === 1 ? matching[0].id : null };
  }
  const own = (sub?.trades ?? []).map((t) => normalizeTrade(t)).find((t) => !!t && !isNonInstallerTrade(t));
  return { scope: own ? tradeLabel(own) : "Sub work", masterPhaseId: null };
}

interface Collected {
  today: string;
  projects: Map<string, ProjectRow>;
  phases: PhaseRow[];
  nobody: PhaseRow[];
  penciled: PhaseRow[];
  unscheduled: { subId: string; projectId: string; firstSeenAt: string | null; posts: number; photos: number; checkedIn: boolean }[];
  error: string | null;
}

/** One read of everything the three lists need. */
async function collect(db: Db, projectId: string | null): Promise<Collected> {
  const today = todayET();
  const horizon = addDays(today, NOBODY_DAYS);
  const pencilHorizon = addDays(today, PENCILED_DAYS);

  let projectQuery = db.from("projects").select("id, name, project_number, status, is_overhead").in("status", [...SUB_LIVE_STATUSES]);
  if (projectId) projectQuery = projectQuery.eq("id", projectId);
  const { data: projectRows, error: projectError } = await projectQuery;
  const projects = new Map(
    ((projectRows ?? []) as ProjectRow[]).filter((p) => !isInternalJob(p)).map((p) => [p.id, p]),
  );
  const ids = Array.from(projects.keys());
  const empty: Collected = { today, projects, phases: [], nobody: [], penciled: [], unscheduled: [], error: projectError?.message ?? null };
  if (!ids.length) return empty;

  const { start, end } = etDayRange(today);
  const [{ data: phaseRows, error: phaseError }, visitsRes, postsRes] = await Promise.all([
    db.from("schedule_phases").select(PHASE_COLUMNS).in("project_id", ids).lte("start_date", horizon).gte("end_date", today).order("start_date").limit(2000),
    db.from("sub_site_visits").select("project_id, subcontractor_id, first_seen_at, posts, photos").eq("visit_date", today).in("project_id", ids),
    db.from("daily_logs").select("project_id, subcontractor_id, started_at").not("subcontractor_id", "is", null).gte("started_at", start).lt("started_at", end).in("project_id", ids),
  ]);
  if (phaseError) return { ...empty, error: phaseError.message };
  const phases = (phaseRows ?? []) as PhaseRow[];

  // Work with nobody on it (a master is staffed when a day row under it has
  // somebody): the shared rule, so the digest's count matches this sheet.
  const nobody = nobodyPhases(phases)
    .sort((a, b) => a.start_date.localeCompare(b.start_date) || (projects.get(a.project_id)?.name ?? "").localeCompare(projects.get(b.project_id)?.name ?? ""));

  // A parked "From Estimate" step (awarded sub pre-filled, placeholder day)
  // isn't penciled in: "Confirm & notify" would email him a parking date.
  const penciled = phases
    .filter((p) => isOpenWork(p) && !p.is_confirmed && !isParkedPlanStep(p) && (p.assigned_sub_ids?.length ?? 0) > 0 && p.start_date <= pencilHorizon)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));

  // Subs who showed up today (a scan or a post) where no phase has them.
  type Seen = Collected["unscheduled"][number];
  const seen = new Map<string, Seen>();
  for (const v of (visitsRes.data ?? []) as { project_id: string; subcontractor_id: string; first_seen_at: string | null; posts: number | null; photos: number | null }[]) {
    seen.set(`${v.subcontractor_id}:${v.project_id}`, {
      subId: v.subcontractor_id,
      projectId: v.project_id,
      firstSeenAt: v.first_seen_at,
      posts: v.posts ?? 0,
      photos: v.photos ?? 0,
      checkedIn: true,
    });
  }
  for (const l of (postsRes.data ?? []) as { project_id: string | null; subcontractor_id: string | null; started_at: string | null }[]) {
    if (!l.project_id || !l.subcontractor_id) continue;
    const key = `${l.subcontractor_id}:${l.project_id}`;
    const row = seen.get(key);
    if (row) {
      if (!row.checkedIn) row.posts += 1;
      continue;
    }
    seen.set(key, { subId: l.subcontractor_id, projectId: l.project_id, firstSeenAt: l.started_at, posts: 1, photos: 0, checkedIn: false });
  }
  const unscheduled = Array.from(seen.values())
    .filter((s) => !phases.some((p) => p.project_id === s.projectId && (p.assigned_sub_ids ?? []).includes(s.subId) && !isParkedPlanStep(p) && coversDay(p.start_date, p.end_date, today)))
    .sort((a, b) => (a.firstSeenAt ?? "").localeCompare(b.firstSeenAt ?? ""));

  // The visits table is new; a read error there must not hide the rest.
  const softError = visitsRes.error ? `Check-ins unavailable: ${visitsRes.error.message}` : null;
  return { today, projects, phases, nobody, penciled, unscheduled, error: softError };
}

const projectFilterSchema = z.string().uuid().nullable().optional();

/** The counts for the board header chip. Cheap: no suggestions. */
export async function getSubsNeededSummary(): Promise<SubsNeededSummary & { error: string | null }> {
  const auth = await officeUser();
  const zero = { nobody: 0, jobsWithNobody: 0, penciled: 0, unscheduled: 0, total: 0 };
  if ("error" in auth) return { ...zero, error: auth.error ?? "Not allowed" };
  const db = await createClient();
  const c = await collect(db, null);
  const jobsWithNobody = new Set(c.nobody.map((p) => p.project_id)).size;
  return {
    nobody: c.nobody.length,
    jobsWithNobody,
    penciled: c.penciled.length,
    unscheduled: c.unscheduled.length,
    total: c.nobody.length + c.penciled.length + c.unscheduled.length,
    error: c.error,
  };
}

/** Everything the Subs needed sheet shows, optionally for one job. */
export async function getSubsNeeded(input?: { projectId?: string | null }): Promise<SubsNeededData> {
  const today = todayET();
  const blank: SubsNeededData = {
    today,
    generatedAt: new Date().toISOString(),
    projectId: null,
    projectName: null,
    nobody: [],
    penciled: [],
    unscheduled: [],
    jobsWithNobody: 0,
    directory: [],
    error: null,
  };
  const parsed = projectFilterSchema.safeParse(input?.projectId ?? null);
  if (!parsed.success) return { ...blank, error: "Pick a valid job." };
  const projectId = parsed.data ?? null;

  const auth = await officeUser();
  if ("error" in auth) return { ...blank, error: auth.error ?? "Not allowed" };
  const db = await createClient();
  const c = await collect(db, projectId);

  const directory = await loadSubDirectory(db);
  const ctx = await loadSuggestContext(db, c.nobody, directory);

  const empIds = Array.from(new Set(c.penciled.flatMap((p) => p.assigned_employee_ids ?? [])));
  const { data: empRows } = empIds.length
    ? await db.from("employees").select("id, first_name, last_name, email").in("id", empIds)
    : { data: [] };
  const employees = new Map(
    ((empRows ?? []) as { id: string; first_name: string | null; last_name: string | null; email: string | null }[]).map((e) => [e.id, e]),
  );

  const projectName = (id: string) => c.projects.get(id)?.name ?? "Job";

  const nobody: SubsNeededNobodyRow[] = c.nobody.map((p) => {
    const s = suggestSubsForPhase(p, ctx);
    return {
      phaseId: p.id,
      projectId: p.project_id,
      projectName: projectName(p.project_id),
      projectNumber: c.projects.get(p.project_id)?.project_number ?? null,
      name: p.name,
      startDate: p.start_date,
      endDate: p.end_date ?? p.start_date,
      isConfirmed: !!p.is_confirmed,
      phaseScope: p.phase_scope,
      hasLine: !!p.estimate_line_item_id,
      trade: s.trade,
      tradeLabel: s.tradeLabel,
      notesHint: s.notesHint,
      suggestions: s.suggestions,
    };
  });

  const penciled: SubsNeededPenciledRow[] = c.penciled.map((p) => {
    const people: SubsNeededPerson[] = [
      ...(p.assigned_sub_ids ?? []).map((id) => {
        const sub = directory.get(id);
        return { id, kind: "sub" as const, name: sub ? subName(sub) : "Sub (inactive)", hasEmail: !!sub?.email?.trim() };
      }),
      ...(p.assigned_employee_ids ?? []).map((id) => {
        const e = employees.get(id);
        const name = e ? [e.first_name, e.last_name].filter(Boolean).join(" ").trim() || "Crew" : "Crew";
        return { id, kind: "employee" as const, name, hasEmail: !!e?.email?.trim() };
      }),
    ];
    return {
      phaseId: p.id,
      projectId: p.project_id,
      projectName: projectName(p.project_id),
      name: p.name,
      startDate: p.start_date,
      endDate: p.end_date ?? p.start_date,
      hasLine: !!p.estimate_line_item_id,
      people,
      // The same rule setPhaseConfirmation applies; it still decides.
      gate: p.estimate_line_item_id ? null : "Attach a budget line item before putting this live.",
    };
  });

  const unscheduled: SubsNeededUnscheduledRow[] = c.unscheduled.map((u) => {
    const sub = directory.get(u.subId);
    const phasesToday = c.phases.filter((p) => p.project_id === u.projectId && coversDay(p.start_date, p.end_date, c.today));
    return {
      key: `${u.subId}:${u.projectId}`,
      subId: u.subId,
      subName: sub ? subName(sub) : "A sub",
      projectId: u.projectId,
      projectName: projectName(u.projectId),
      firstSeenAt: u.firstSeenAt,
      firstSeenLabel: u.firstSeenAt ? etTimeLabel(u.firstSeenAt) : "",
      posts: u.posts,
      photos: u.photos,
      checkedIn: u.checkedIn,
      scope: scopeForSub(sub, phasesToday).scope,
    };
  });

  return {
    today: c.today,
    generatedAt: new Date().toISOString(),
    projectId,
    projectName: projectId ? c.projects.get(projectId)?.name ?? null : null,
    nobody,
    penciled,
    unscheduled,
    jobsWithNobody: new Set(c.nobody.map((p) => p.project_id)).size,
    directory: Array.from(directory.values())
      .filter((s) => !isNonInstallerSub(s))
      .map((s) => ({
        id: s.id,
        name: subName(s),
        trades: (s.trades ?? []).map((t) => normalizeTrade(t)).filter((t): t is string => !!t),
        hasEmail: !!s.email?.trim(),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    error: c.error,
  };
}

/** Suggestion chips for one phase on the board panel. */
export async function getPhaseSubSuggestions(input: { phaseId: string }): Promise<PhaseSuggestions & { error: string | null }> {
  const none = { trade: null, tradeLabel: null, suggestions: [], notesHint: null };
  if (!z.string().uuid().safeParse(input?.phaseId).success) return { ...none, error: "Pick a valid phase." };
  const auth = await officeUser();
  if ("error" in auth) return { ...none, error: auth.error ?? "Not allowed" };
  const db = await createClient();
  const { data: phase } = await db.from("schedule_phases").select(PHASE_COLUMNS).eq("id", input.phaseId).maybeSingle();
  if (!phase) return { ...none, error: "Phase not found." };
  const p = phase as PhaseRow;
  if (NOT_WORK_EVENTS.has(p.event_type ?? "") || isNonWorkPhaseName(p.name)) return { ...none, error: null };
  const ctx = await loadSuggestContext(db, [p]);
  return { ...suggestSubsForPhase(p, ctx), error: null };
}

/** The "Remember: 'Marcio' in notes means MGL Tile Inc" offer after a pick from the regular picker. */
export async function getAliasOffer(input: { phaseId: string; subId: string }): Promise<{ alias: string | null; subName: string | null }> {
  const ok = z.object({ phaseId: z.string().uuid(), subId: z.string().uuid() }).safeParse(input);
  if (!ok.success) return { alias: null, subName: null };
  const auth = await officeUser();
  if ("error" in auth) return { alias: null, subName: null };
  const db = await createClient();
  const [{ data: phase }, directory] = await Promise.all([
    db.from("schedule_phases").select("name, notes").eq("id", ok.data.phaseId).maybeSingle(),
    loadSubDirectory(db),
  ]);
  const sub = directory.get(ok.data.subId);
  if (!phase || !sub) return { alias: null, subName: null };
  // A strict hit already names him; nothing to learn.
  return {
    alias: aliasOfferFor(phase as { name: string | null; notes: string | null }, sub, directory.values()),
    subName: subName(sub),
  };
}

const assignSchema = z.object({
  items: z
    .array(
      z.object({
        phaseId: z.string().uuid(),
        projectId: z.string().uuid(),
        subIds: z.array(z.string().uuid()).min(1).max(10),
      }),
    )
    .min(1, "Nothing to assign.")
    .max(100, "That's too many at once."),
});

export interface AssignSubsResult {
  error: string | null;
  results: {
    phaseId: string;
    error: string | null;
    added: string[];
    /** Who got the "You're scheduled" email (confirmed phases only). */
    emailed: string[];
    wasConfirmed: boolean;
  }[];
  aliasOffers: { phaseId: string; subId: string; subName: string; alias: string }[];
}

/**
 * Add subs to phases, one tap for one or many. Each phase goes through
 * `updateSchedulePhase`, so a CONFIRMED phase emails the newly added sub
 * "You're scheduled" (the sheet names who before the tap) and a penciled-in
 * one emails nobody. Existing assignees are kept.
 */
export async function assignSubsToPhases(input: { items: { phaseId: string; projectId: string; subIds: string[] }[] }): Promise<AssignSubsResult> {
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the details.", results: [], aliasOffers: [] };
  const auth = await officeUser();
  if ("error" in auth) return { error: auth.error ?? "Not allowed", results: [], aliasOffers: [] };
  const db = await createClient();

  const phaseIds = Array.from(new Set(parsed.data.items.map((i) => i.phaseId)));
  const [{ data: phaseRows, error: readError }, directory] = await Promise.all([
    db.from("schedule_phases").select("id, project_id, name, notes, is_confirmed, assigned_sub_ids").in("id", phaseIds),
    loadSubDirectory(db),
  ]);
  if (readError) return { error: readError.message, results: [], aliasOffers: [] };
  const phases = new Map(
    ((phaseRows ?? []) as { id: string; project_id: string; name: string; notes: string | null; is_confirmed: boolean | null; assigned_sub_ids: string[] | null }[]).map((p) => [p.id, p]),
  );

  const results: AssignSubsResult["results"] = [];
  const aliasOffers: AssignSubsResult["aliasOffers"] = [];
  for (const item of parsed.data.items) {
    const phase = phases.get(item.phaseId);
    if (!phase || phase.project_id !== item.projectId) {
      results.push({ phaseId: item.phaseId, error: "That phase changed or is gone. Refresh and try again.", added: [], emailed: [], wasConfirmed: false });
      continue;
    }
    const unknown = item.subIds.find((id) => !directory.has(id));
    if (unknown) {
      results.push({ phaseId: item.phaseId, error: "That sub is inactive or no longer in the directory.", added: [], emailed: [], wasConfirmed: !!phase.is_confirmed });
      continue;
    }
    const current = phase.assigned_sub_ids ?? [];
    const added = item.subIds.filter((id) => !current.includes(id));
    if (!added.length) {
      results.push({ phaseId: item.phaseId, error: null, added: [], emailed: [], wasConfirmed: !!phase.is_confirmed });
      continue;
    }
    const res = await updateSchedulePhase(item.phaseId, {
      project_id: item.projectId,
      assigned_sub_ids: [...current, ...added],
    });
    results.push({
      phaseId: item.phaseId,
      error: res.error,
      added: added.map((id) => subName(directory.get(id)!)),
      emailed: res.notify?.emailed ?? [],
      wasConfirmed: !!phase.is_confirmed,
    });
    if (res.error) continue;
    for (const id of added) {
      const sub = directory.get(id)!;
      const alias = aliasOfferFor(phase, sub, directory.values());
      if (alias) aliasOffers.push({ phaseId: item.phaseId, subId: id, subName: subName(sub), alias });
    }
  }

  const failed = results.filter((r) => r.error);
  return {
    error: failed.length === results.length && failed.length ? failed[0].error : null,
    results,
    aliasOffers,
  };
}

const aliasSchema = z.object({
  subId: z.string().uuid(),
  alias: z.string().trim().min(1, "Type the name the notes use.").max(40),
});

/**
 * Save "Marcio" as a name for MGL Tile Inc, so notes that say "Marcio" point
 * at MGL from now on. Only ever called from the office's explicit tap.
 */
export async function saveSubAlias(input: { subId: string; alias: string }): Promise<{ error: string | null; aliases: string[] }> {
  const parsed = aliasSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the alias.", aliases: [] };
  const auth = await officeUser();
  if ("error" in auth) return { error: auth.error ?? "Not allowed", aliases: [] };

  const admin = createAdminClient();
  const [{ data: row }, directory] = await Promise.all([
    admin.from("subcontractors").select("id, company_name, contact_name, trades, aliases, email, is_active").eq("id", parsed.data.subId).maybeSingle(),
    loadSubDirectory(admin),
  ]);
  if (!row) return { error: "That sub isn't in the directory.", aliases: [] };
  const sub = row as SubDirectoryEntry;
  const alias = parsed.data.alias.replace(/\s+/g, " ");
  const existing = sub.aliases ?? [];
  if (existing.some((a) => a.trim().toLowerCase() === alias.toLowerCase())) return { error: null, aliases: existing };
  const problem = aliasProblem(alias, sub, directory.values());
  if (problem) return { error: problem, aliases: existing };

  const next = [...existing, alias];
  const { error } = await admin.from("subcontractors").update({ aliases: next }).eq("id", sub.id);
  if (error) return { error: error.message, aliases: existing };

  revalidatePath("/subcontractors");
  revalidatePath("/board");
  return { error: null, aliases: next };
}

/**
 * "Confirm & notify" for a penciled-in phase: exactly `setPhaseConfirmation`,
 * gate and all. A missing budget line comes back as the gate's own message.
 */
export async function confirmAndNotify(input: { phaseId: string; projectId: string }): Promise<{ error: string | null; emailed: string[]; skipped: string[]; notifyError: string | null }> {
  const ok = z.object({ phaseId: z.string().uuid(), projectId: z.string().uuid() }).safeParse(input);
  if (!ok.success) return { error: "Pick a valid phase.", emailed: [], skipped: [], notifyError: null };
  const auth = await officeUser();
  if ("error" in auth) return { error: auth.error ?? "Not allowed", emailed: [], skipped: [], notifyError: null };
  const res = await setPhaseConfirmation(ok.data.phaseId, ok.data.projectId, true);
  return {
    error: res.error,
    emailed: res.notify?.emailed ?? [],
    skipped: res.notify?.skipped ?? [],
    notifyError: res.notify?.error ?? null,
  };
}

/**
 * "Put MGL on today": a sub who checked in or posted at a job where no phase
 * has him gets a day row there through the crew board's own writer — daily,
 * penciled in (so nobody is emailed), named for the trade ("Demolition"),
 * never for the sub. When exactly one open master step there today is his
 * trade, the day is filed under it.
 */
export async function putSubOnToday(input: { subId: string; projectId: string }): Promise<{ error: string | null; scope: string | null }> {
  const ok = z.object({ subId: z.string().uuid(), projectId: z.string().uuid() }).safeParse(input);
  if (!ok.success) return { error: "Pick a valid sub and job.", scope: null };
  const auth = await officeUser();
  if ("error" in auth) return { error: auth.error ?? "Not allowed", scope: null };
  const db = await createClient();
  const today = todayET();

  const [{ data: sub }, { data: phaseRows }] = await Promise.all([
    db.from("subcontractors").select("id, company_name, contact_name, trades, aliases, email, is_active").eq("id", ok.data.subId).maybeSingle(),
    db.from("schedule_phases").select(PHASE_COLUMNS).eq("project_id", ok.data.projectId).lte("start_date", today).gte("end_date", today),
  ]);
  if (!sub) return { error: "That sub isn't in the directory.", scope: null };
  const { scope, masterPhaseId } = scopeForSub(sub as SubDirectoryEntry, (phaseRows ?? []) as PhaseRow[]);

  const res = await setCrewAssignment({
    personKind: "sub",
    personId: ok.data.subId,
    date: today,
    projectId: ok.data.projectId,
    scope,
    confirmed: false,
    ...(masterPhaseId ? { masterPhaseId } : {}),
  });
  return { error: res.error ?? null, scope };
}
