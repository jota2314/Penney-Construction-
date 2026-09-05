import type { SupabaseClient } from "@supabase/supabase-js";
import { combineFieldDays, FIELD_LEARNING_RULES, type FieldLog } from "./field-learning";

export async function loadFieldLearning(db: SupabaseClient) {
  const { data: { user } } = await db.auth.getUser();
  if (!user) throw new Error("Field learning requires authentication");
  const { data: profile, error: profileError } = await db.from("profiles").select("role").eq("id", user.id).single();
  if (profileError) throw new Error(profileError.message);
  if (!["owner", "precon_manager", "office_admin"].includes(profile?.role)) return [];
  const since = new Date(Date.now() - 180 * 86400000).toISOString();
  const logs: FieldLog[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("daily_logs")
      .select("id,author_id,project_id,text,started_at,ended_at,created_at,status,auto_clocked_out,estimate_line_item_id,line_item_needs_review,phase:schedule_phases!schedule_phase_id(project_id)")
      .or(`started_at.gte.${since},and(started_at.is.null,created_at.gte.${since})`).order("id").range(from, from + 999);
    if (error) throw new Error(`Field logs could not load: ${error.message}`);
    for (const row of data || []) {
      const phase = Array.isArray(row.phase) ? row.phase[0] : row.phase;
      logs.push({ ...row, project_id: row.project_id || phase?.project_id || null });
    }
    if (!data || data.length < 1000) break;
  }
  const days = combineFieldDays(logs);
  const ids = [...new Set(days.map(day => day.projectId))];
  const names = new Map<string, { name: string; project_type: string }>();
  for (let from = 0; from < ids.length; from += 100) {
    const { data, error } = await db.from("projects").select("id,name,project_type").in("id", ids.slice(from, from + 100));
    if (error) throw new Error(error.message);
    for (const project of data || []) names.set(project.id, project);
  }
  const workerIds = [...new Set(days.map(day => day.workerId))];
  const workers = new Map<string, string>();
  for (let from = 0; from < workerIds.length; from += 100) {
    const { data, error } = await db.from("profiles").select("id,full_name").in("id", workerIds.slice(from, from + 100));
    if (error) throw new Error(error.message);
    for (const worker of data || []) workers.set(worker.id, worker.full_name || "Crew member");
  }
  return days.map(day => ({ ...day, workerName: workers.get(day.workerId) || "Crew member", projectName: names.get(day.projectId)?.name || "Project", projectType: names.get(day.projectId)?.project_type || "unknown" }));
}

export async function fieldLearningContext(db: SupabaseClient, options: { projectId?: string; projectType?: string; scope?: string } = {}) {
  try {
    const days = await loadFieldLearning(db);
    const words = [...new Set((options.scope || "").toLowerCase().match(/[a-z]{4,}/g) || [])].filter(word => !["this", "that", "with", "from", "have", "project", "estimate"].includes(word));
    const score = (day: typeof days[number]) => {
      const text = day.notes.map(note => note.text).join(" ").toLowerCase();
      return (day.projectId === options.projectId ? 20 : 0) + (day.projectType === options.projectType ? 4 : 0) + words.filter(word => text.includes(word)).length;
    };
    const selected = days.filter(day => day.notes.length && day.hours > 0)
      .sort((a, b) => score(b) - score(a) || b.day.localeCompare(a.day)).slice(0, 24);
    const evidence: unknown[] = [];
    let characters = 0;
    for (const day of selected) {
      const row = { ...day, noteCount: day.notes.length, notes: day.notes.slice(0, 8).map(note => ({ ...note, text: note.text.slice(0, 1200) })) };
      const size = JSON.stringify(row).length;
      if (characters + size > 24000) break;
      evidence.push(row); characters += size;
    }
    return FIELD_LEARNING_RULES + `\nRecent 180-day evidence; ${evidence.length} worker/job/day examples selected from ${days.length}. This is a sample, not complete job labor. Note excerpts may be shortened.\n` +
      JSON.stringify(evidence) +
      (selected.length ? "" : "\nNo paired hours-and-notes examples available. Do not claim historical labor calibration.");
  } catch (error) {
    console.error("[field-learning]", error instanceof Error ? error.message : error);
    return FIELD_LEARNING_RULES + "\nField learning is unavailable for this request. Do not claim to have reviewed the daily logs or use invented historical hours.";
  }
}
