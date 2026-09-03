import "server-only";

import { createClient } from "@/lib/supabase/server";
import { addDays, dateToStr } from "./board-data";
import { projectColor } from "./crew-colors";

/**
 * The crew board — who is where, each day.
 *
 * The lanes view answers "what's happening on each job". This answers the
 * question Jorge actually plans by: "what is each person doing tomorrow".
 * Same table underneath — `schedule_phases` — read sideways: every phase that
 * assigns a person lands in that person's row on every day it covers.
 *
 * Rows the board writes are tagged `event_type = 'crew'` (one person, one
 * job, a run of days). Rows from anywhere else — clock-ins, the schedule chat,
 * the project page — show up too, marked so the editor knows not to reshape
 * them. Nothing here is a second copy of the schedule; it IS the schedule.
 */

/** Weeks before the current one to load — lets Jorge look back at last week. */
const WEEKS_BACK = 1;
/** Weeks after the current one, inclusive of it. */
const WEEKS_FORWARD = 5;

/** Board-written rows carry this event type. */
export const CREW_EVENT_TYPE = "crew";

export interface CrewPerson {
  /** `emp:<id>` or `sub:<id>` — the grid key. */
  key: string;
  kind: "employee" | "sub";
  id: string;
  name: string;
  title: string | null;
}

export interface CrewCell {
  phaseId: string;
  projectId: string | null;
  projectName: string;
  projectNumber: string;
  /** What they're doing — the phase name. */
  name: string;
  color: string;
  confirmed: boolean;
  /** Written by this board, so the editor may split/extend/delete it. */
  boardOwned: boolean;
  /** More than one person is on this phase. */
  shared: boolean;
  status: string;
  startDate: string;
  endDate: string;
}

export interface CrewDay {
  str: string;
  dayName: string;
  label: string;
  isToday: boolean;
  isPast: boolean;
  isWeekend: boolean;
}

export interface CrewWeek {
  start: string;
  label: string;
  days: CrewDay[];
}

export interface CrewProjectOption {
  id: string;
  name: string;
  projectNumber: string;
  status: string;
  color: string;
}

export interface CrewBoardData {
  todayStr: string;
  /** Index into `weeks` of the week containing today. */
  thisWeekIndex: number;
  weeks: CrewWeek[];
  people: CrewPerson[];
  /** personKey → date → phases covering that person that day. */
  cells: Record<string, Record<string, CrewCell[]>>;
  /** Jobs the editor can assign someone to. */
  projects: CrewProjectOption[];
  /** Every active sub, for adding a sub row. */
  subs: { id: string; name: string }[];
}

interface PhaseRow {
  id: string;
  project_id: string | null;
  name: string;
  start_date: string;
  end_date: string;
  status: string;
  color: string | null;
  event_type: string | null;
  is_confirmed: boolean | null;
  assigned_employee_ids: string[] | null;
  assigned_sub_ids: string[] | null;
}

/** Field roster — the people who get a row without being scheduled first. */
const FIELD_TITLE = /carpenter|laborer|field lead|foreman/i;

function rosterRank(title: string | null) {
  const t = title ?? "";
  if (/lead|foreman/i.test(t)) return 0;
  if (/carpenter/i.test(t)) return 1;
  if (/apprentice/i.test(t)) return 2;
  return 3;
}

function mondayOf(d: Date) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7));
  return r;
}

function buildWeeks(todayStr: string): { weeks: CrewWeek[]; thisWeekIndex: number } {
  const thisMonday = mondayOf(new Date());
  const first = addDays(thisMonday, -7 * WEEKS_BACK);
  const weeks: CrewWeek[] = [];
  for (let w = 0; w < WEEKS_BACK + WEEKS_FORWARD; w++) {
    const start = addDays(first, 7 * w);
    const days: CrewDay[] = Array.from({ length: 7 }, (_, i) => {
      const d = addDays(start, i);
      const str = dateToStr(d);
      return {
        str,
        dayName: d.toLocaleDateString("en-US", { weekday: "short" }),
        label: d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" }),
        isToday: str === todayStr,
        isPast: str < todayStr,
        isWeekend: d.getDay() === 0 || d.getDay() === 6,
      };
    });
    const end = addDays(start, 6);
    const sameMonth = start.getMonth() === end.getMonth();
    const label = sameMonth
      ? `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${end.getDate()}`
      : `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
    weeks.push({ start: dateToStr(start), label, days });
  }
  return { weeks, thisWeekIndex: WEEKS_BACK };
}

export async function getCrewBoardData(): Promise<CrewBoardData> {
  const supabase = await createClient();
  const todayStr = dateToStr(new Date());
  const { weeks, thisWeekIndex } = buildWeeks(todayStr);
  const firstStr = weeks[0].days[0].str;
  const lastStr = weeks[weeks.length - 1].days[6].str;

  const [{ data: employeeRows }, { data: subRows }, { data: phaseRows }, { data: projectRows }] =
    await Promise.all([
      supabase
        .from("employees")
        .select("id, first_name, last_name, title, status")
        .eq("status", "active"),
      supabase
        .from("subcontractors")
        .select("id, company_name, contact_name, is_active")
        .eq("is_active", true)
        .order("company_name"),
      supabase
        .from("schedule_phases")
        .select(
          "id, project_id, name, start_date, end_date, status, color, event_type, is_confirmed, assigned_employee_ids, assigned_sub_ids",
        )
        .lte("start_date", lastStr)
        .gte("end_date", firstStr)
        .order("start_date"),
      supabase
        .from("projects")
        .select("id, name, project_number, status")
        .in("status", ["in_progress", "contracted"])
        .eq("is_overhead", false)
        .order("name"),
    ]);

  const phases = ((phaseRows ?? []) as PhaseRow[]).filter(
    (p) => (p.assigned_employee_ids?.length ?? 0) > 0 || (p.assigned_sub_ids?.length ?? 0) > 0,
  );

  // ── Projects: the picker list plus anything a phase points at ──
  const projectById = new Map<string, CrewProjectOption>();
  for (const p of (projectRows ?? []) as {
    id: string;
    name: string;
    project_number: string;
    status: string;
  }[]) {
    projectById.set(p.id, {
      id: p.id,
      name: p.name,
      projectNumber: p.project_number,
      status: p.status,
      color: projectColor(p.id),
    });
  }
  const missing = Array.from(
    new Set(
      phases
        .map((p) => p.project_id)
        .filter((id): id is string => !!id && !projectById.has(id)),
    ),
  );
  if (missing.length) {
    const { data: extra } = await supabase
      .from("projects")
      .select("id, name, project_number, status")
      .in("id", missing);
    for (const p of (extra ?? []) as {
      id: string;
      name: string;
      project_number: string;
      status: string;
    }[]) {
      projectById.set(p.id, {
        id: p.id,
        name: p.name,
        projectNumber: p.project_number,
        status: p.status,
        color: projectColor(p.id),
      });
    }
  }

  // ── People: the field roster, plus anyone else who is scheduled ──
  const employees = ((employeeRows ?? []) as {
    id: string;
    first_name: string | null;
    last_name: string | null;
    title: string | null;
  }[]).map((e) => ({
    id: e.id,
    name: [e.first_name, e.last_name].filter(Boolean).join(" ").trim() || "Unnamed",
    title: e.title,
  }));
  const employeeById = new Map(employees.map((e) => [e.id, e]));

  const subs = ((subRows ?? []) as {
    id: string;
    company_name: string | null;
    contact_name: string | null;
  }[]).map((s) => ({
    id: s.id,
    name: s.company_name?.trim() || s.contact_name?.trim() || "Unnamed sub",
  }));
  const subById = new Map(subs.map((s) => [s.id, s]));

  const scheduledEmp = new Set<string>();
  const scheduledSub = new Set<string>();
  for (const p of phases) {
    for (const id of p.assigned_employee_ids ?? []) scheduledEmp.add(id);
    for (const id of p.assigned_sub_ids ?? []) scheduledSub.add(id);
  }

  const people: CrewPerson[] = [];
  const roster = employees
    .filter((e) => (FIELD_TITLE.test(e.title ?? "") || scheduledEmp.has(e.id)) && !/test/i.test(e.title ?? ""))
    .sort((a, b) => rosterRank(a.title) - rosterRank(b.title) || a.name.localeCompare(b.name));
  for (const e of roster) {
    people.push({ key: `emp:${e.id}`, kind: "employee", id: e.id, name: e.name, title: e.title });
  }
  for (const id of scheduledSub) {
    const s = subById.get(id);
    if (!s) continue;
    people.push({ key: `sub:${id}`, kind: "sub", id, name: s.name, title: "Sub" });
  }

  // ── Cells ──
  const cells: Record<string, Record<string, CrewCell[]>> = {};
  const put = (key: string, date: string, cell: CrewCell) => {
    const row = (cells[key] ??= {});
    (row[date] ??= []).push(cell);
  };

  for (const p of phases) {
    const proj = p.project_id ? projectById.get(p.project_id) : undefined;
    const assignees = (p.assigned_employee_ids?.length ?? 0) + (p.assigned_sub_ids?.length ?? 0);
    const cell: CrewCell = {
      phaseId: p.id,
      projectId: p.project_id,
      projectName: proj?.name ?? "No project",
      projectNumber: proj?.projectNumber ?? "",
      name: p.name,
      color: p.color || projectColor(p.project_id),
      confirmed: !!p.is_confirmed,
      boardOwned: p.event_type === CREW_EVENT_TYPE,
      shared: assignees > 1,
      status: p.status,
      startDate: p.start_date,
      endDate: p.end_date,
    };
    const start = p.start_date < firstStr ? firstStr : p.start_date;
    const end = p.end_date > lastStr ? lastStr : p.end_date;
    for (let d = new Date(`${start}T00:00:00`); dateToStr(d) <= end; d = addDays(d, 1)) {
      const str = dateToStr(d);
      for (const id of p.assigned_employee_ids ?? []) {
        if (employeeById.has(id)) put(`emp:${id}`, str, cell);
      }
      for (const id of p.assigned_sub_ids ?? []) {
        if (subById.has(id)) put(`sub:${id}`, str, cell);
      }
    }
  }

  return {
    todayStr,
    thisWeekIndex,
    weeks,
    people,
    cells,
    projects: Array.from(projectById.values())
      .filter((p) => p.status === "in_progress" || p.status === "contracted")
      .sort((a, b) => a.name.localeCompare(b.name)),
    subs,
  };
}
