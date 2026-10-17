import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getAnthropicClient,
  CLAUDE_FALLBACK_MODELS,
  logAiUsage,
} from "@/lib/ai/claude";
import { buildSchedulePrompt } from "@/lib/ai/prompts/schedule";
import { loadScheduleContext } from "@/lib/ai/shared-context";
import { deleteSchedulePhase, updateSchedulePhase } from "@/lib/actions/schedule";
import { isCalendarDate } from "@/lib/schedule/date-patch";
import { revalidateSchedule } from "@/lib/schedule/revalidate";
import { describeSub, resolveSubName, subName, type SubDirectoryEntry } from "@/lib/schedule/suggest-subs";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { messages: chatHistory, userMessage, projectContext } = await request.json();
    if (!userMessage)
      return NextResponse.json({ error: "userMessage required" }, { status: 400 });

    // Load schedule context via shared loader
    const scheduleCtx = await loadScheduleContext(supabase, projectContext?.id);
    const projects = scheduleCtx.activeProjects;
    const employees = scheduleCtx.crew;

    const systemPrompt = await buildSchedulePrompt(scheduleCtx) + `

## RESPONSE FORMAT
Return a JSON object:
{
  "message": "Your conversational response — be specific about scheduling",
  "schedule_actions": [
    {
      "action": "create" | "update" | "delete",
      "name": "Phase/event name",
      "project_name": "Project name",
      "start_date": "YYYY-MM-DD",
      "end_date": "YYYY-MM-DD",
      "phase_scope": "master for project activities or milestones; daily for a crew assignment",
      "assigned_to": ["First Last", ...],
      "assigned_subs": ["Sub company or name exactly as the user said it", ...],
      "notes": "Details",
      "status": "not_started" | "in_progress" | "completed" | "on_hold",
      "event_type": "phase" | "meeting" | "walkthrough" | "inspection"
    }
  ]
}

IMPORTANT FOR UPDATES:
- To update: "action": "update", "name" matches existing phase name
- To delete: "action": "delete", "name" matches existing phase name
- "assigned_subs" on an update ADDS those subs to the phase; leave it out to keep the subs as they are
- Be conversational and practical — think like a construction superintendent`;

    // Subs are resolved strictly and only from names the user typed in this
    // message: never from notes, never a guess. Ambiguity comes back as a
    // question in `executed`.
    const userText = String(userMessage).toLowerCase();
    let subDirectory: SubDirectoryEntry[] | null = null;
    const resolveSubs = async (raw: unknown, notes: string[]): Promise<{ ids: string[]; names: string[] }> => {
      const asked = (Array.isArray(raw) ? raw : []).map((n) => String(n ?? "").trim()).filter(Boolean);
      if (!asked.length) return { ids: [], names: [] };
      if (!subDirectory) {
        const { data } = await supabase
          .from("subcontractors")
          .select("id, company_name, contact_name, trades, aliases, email, is_active")
          .eq("is_active", true);
        subDirectory = (data ?? []) as SubDirectoryEntry[];
      }
      const ids: string[] = [];
      const names: string[] = [];
      for (const name of asked) {
        if (!userText.includes(name.toLowerCase())) {
          notes.push(`Left "${name}" off: only subs you name in your message go on the schedule.`);
          continue;
        }
        const found = resolveSubName(name, subDirectory);
        if (found.unique) {
          if (!ids.includes(found.unique.id)) {
            ids.push(found.unique.id);
            names.push(subName(found.unique));
          }
        } else if (!found.candidates.length) {
          notes.push(`No sub matches "${name}". Which company is it?`);
        } else if (found.firstNameOnly && found.candidates.length === 1) {
          notes.push(`Did you mean ${describeSub(found.candidates[0].sub)}? Say the company name and I'll put them on it.`);
        } else {
          notes.push(`More than one sub matches "${name}": ${found.candidates.map((c) => describeSub(c.sub)).join(" or ")}. Which one?`);
        }
      }
      return { ids, names };
    };
    const notEmailed = (names: string[]) =>
      names.length
        ? `${names.join(", ")} ${names.length === 1 ? "is" : "are"} on it; not emailed. Use Confirm & notify on the Job Board to send the schedule email.`
        : "";

    // Build messages
    const claudeMessages: { role: "user" | "assistant"; content: string }[] = [];
    if (chatHistory && Array.isArray(chatHistory)) {
      for (const msg of chatHistory.slice(-20)) {
        claudeMessages.push({ role: msg.role, content: msg.content });
      }
    }
    claudeMessages.push({ role: "user", content: userMessage });

    // Call Claude
    const anthropic = await getAnthropicClient();
    let rawContent = "";

    for (const model of CLAUDE_FALLBACK_MODELS) {
      try {
        const response = await anthropic.messages.create({
          model,
          max_tokens: 4096,
          system: systemPrompt,
          messages: claudeMessages,
        });
        rawContent =
          response.content[0]?.type === "text"
            ? response.content[0].text.trim()
            : "";
        if (rawContent) {
          if (response.usage) {
            logAiUsage({
              userId: user.id,
              endpoint: "schedule-chat",
              model,
              inputTokens: response.usage.input_tokens,
              outputTokens: response.usage.output_tokens,
              context: "schedule-meeting",
            });
          }
          break;
        }
      } catch {
        continue;
      }
    }

    if (!rawContent) {
      return NextResponse.json({ error: "AI failed" }, { status: 500 });
    }

    // Parse response
    let result: Record<string, unknown> = {};
    const cleaned = rawContent
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    try {
      const obj = JSON.parse(cleaned);
      if (obj && typeof obj.message === "string") result = obj;
    } catch {
      const jsonStart = cleaned.indexOf("{");
      const jsonEnd = cleaned.lastIndexOf("}");
      if (jsonStart !== -1 && jsonEnd > jsonStart) {
        try {
          const obj = JSON.parse(cleaned.substring(jsonStart, jsonEnd + 1));
          if (obj && typeof obj.message === "string") result = obj;
        } catch { /* fallback */ }
      }
    }

    if (!result.message) result = { message: cleaned };

    // Execute schedule actions if any
    const actions = (result.schedule_actions as Array<Record<string, unknown>>) || [];
    const executedActions: string[] = [];

    for (const action of actions) {
      try {
        if (action.action === "create") {
          // Find project
          let projectId: string | null = null;
          if (action.project_name) {
            const proj = projects.find(
              (p) => p.name.toLowerCase().includes((action.project_name as string).toLowerCase())
            );
            if (proj) projectId = proj.id;
          }

          // Find employee IDs
          const assignedIds: string[] = [];
          const assignedNames = (action.assigned_to as string[]) || [];
          for (const name of assignedNames) {
            const emp = employees.find(
              (e) => `${e.first_name} ${e.last_name}`.toLowerCase().includes(name.toLowerCase()) ||
                     e.first_name.toLowerCase() === name.toLowerCase()
            );
            if (emp) assignedIds.push(emp.id);
          }

          if (projectId) {
            const startDate = String(action.start_date ?? "");
            const endDate = String(action.end_date || startDate);
            if (!isCalendarDate(startDate) || !isCalendarDate(endDate) || endDate < startDate) {
              executedActions.push(`Could not create ${action.name}: choose valid start and end dates.`);
              continue;
            }
            // Dedup: skip if a phase with same name + project + start_date already exists
            const { data: existing } = await supabase
              .from("schedule_phases")
              .select("id")
              .eq("project_id", projectId)
              .eq("name", (action.name as string) || "Scheduled work")
              .eq("start_date", action.start_date as string)
              .limit(1);

            if (existing && existing.length > 0) {
              executedActions.push(`Skipped (already exists): ${action.name} on ${action.start_date}`);
            } else {
              const subs = await resolveSubs(action.assigned_subs, executedActions);
              const { error: createError } = await supabase.from("schedule_phases").insert({
                project_id: projectId,
                name: (action.name as string) || "Scheduled work",
                start_date: action.start_date as string,
                end_date: action.end_date as string || action.start_date as string,
                planned_start_date: action.start_date as string,
                planned_end_date: action.end_date as string || action.start_date as string,
                status: "not_started",
                phase_scope: action.event_type === "inspection" || action.phase_scope === "master" ? "master" : "daily",
                is_manually_scheduled: true,
                assigned_employee_ids: assignedIds,
                assigned_sub_ids: subs.ids,
                notes: (action.notes as string) || null,
                event_type: (action.event_type as string) || "phase",
                sort_order: 0,
                color: action.event_type === "inspection" ? "#ef4444" : action.event_type === "walkthrough" ? "#f59e0b" : "#8b5cf6",
                created_by: user.id,
              });
              if (createError) executedActions.push(`Could not create ${action.name}: ${createError.message}`);
              else {
                revalidateSchedule(projectId);
                executedActions.push(`Created: ${action.name} on ${action.start_date}`);
                // New rows start unconfirmed: nobody is emailed.
                if (subs.names.length) executedActions.push(notEmailed(subs.names));
              }
            }
          }
        } else if (action.action === "update") {
          const phaseName = String(action.name ?? "").trim().toLowerCase();
          const projectName = String(action.project_name ?? "").trim().toLowerCase();
          if (!phaseName) { executedActions.push("Choose the exact phase to update."); continue; }

          // Scope to the open job, else to the one job the user named. A bare
          // phase name across every job can only move a date when exactly one
          // phase matches; it never puts a sub on a phase.
          let scopeProjectId: string | null = projectContext?.id ?? null;
          if (!scopeProjectId && projectName) {
            const hits = projects.filter((p) => p.name.toLowerCase().includes(projectName));
            if (hits.length === 1) scopeProjectId = hits[0].id;
            else if (hits.length === 0) {
              const { data: named } = await supabase.from("projects").select("id").ilike("name", `%${projectName}%`).limit(2);
              if (named?.length === 1) scopeProjectId = named[0].id;
            }
          }

          let phaseQuery = supabase
            .from("schedule_phases")
            .select("id, name, project_id, start_date, end_date, is_confirmed, assigned_sub_ids, phase_scope, project:projects(name)")
            .ilike("name", `%${phaseName}%`);
          if (scopeProjectId) phaseQuery = phaseQuery.eq("project_id", scopeProjectId);
          const { data: matchingPhases, error: matchError } = await phaseQuery;
          if (matchError) { executedActions.push(`Could not find the phase: ${matchError.message}`); continue; }

          let matches = matchingPhases ?? [];
          if (matches.length > 1) {
            const exact = matches.filter((p) => String(p.name ?? "").trim().toLowerCase() === phaseName);
            if (exact.length) matches = exact;
          }
          // Day rows share their step's trade name ("Tile"); the master step wins a tie on one job.
          if (matches.length > 1 && scopeProjectId) {
            const master = matches.filter((p) => p.phase_scope === "master");
            if (master.length === 1) matches = master;
          }
          if (matches.length > 1) {
            executedActions.push(`More than one phase matches "${action.name}"${scopeProjectId ? "" : " across jobs"}. Which job and phase?`);
            continue;
          }
          const targetPhase = matches[0];
          if (!targetPhase) { executedActions.push(`Could not find phase "${action.name}" to update`); continue; }
          if (!targetPhase.project_id) { executedActions.push("Choose a project before updating this event."); continue; }
          const joined = targetPhase.project as { name?: string | null } | { name?: string | null }[] | null;
          const jobName = (Array.isArray(joined) ? joined[0]?.name : joined?.name) || "job";

          // On a confirmed phase, a date move emails the crew and subs already
          // on it (they were told the old dates), same as the board and the
          // main chat's update_schedule_phase.
          const result = await updateSchedulePhase(targetPhase.id, {
            project_id: targetPhase.project_id,
            ...(action.start_date ? { start_date: String(action.start_date) } : {}),
            ...(action.end_date ? { end_date: String(action.end_date) } : {}),
            ...(action.start_date || action.end_date ? { is_manually_scheduled: true } : {}),
            ...(action.status ? { status: String(action.status) } : {}),
            ...(action.notes ? { notes: String(action.notes) } : {}),
          });
          if (result.error) { executedActions.push(`Could not update ${jobName} · ${targetPhase.name}: ${result.error}`); continue; }

          const newStart = action.start_date ? String(action.start_date) : targetPhase.start_date;
          const newEnd = action.end_date ? String(action.end_date) : targetPhase.end_date;
          executedActions.push(`Updated: ${jobName} · ${targetPhase.name} → ${newStart} to ${newEnd}`);
          if (result.notify?.emailed.length) executedActions.push(`Emailed schedule update to: ${result.notify.emailed.join(", ")}`);
          if (result.notify?.skipped.length) executedActions.push(`No email on file, not told about the change: ${result.notify.skipped.join(", ")}`);
          if (result.notify?.error) executedActions.push(`Schedule email not sent: ${result.notify.error}`);

          const current: string[] = targetPhase.assigned_sub_ids ?? [];

          // Subs are added straight to the row, not through
          // updateSchedulePhase, which would email them on a confirmed
          // phase. The office sends that email from the board. Only on a
          // job that was named or open, never a cross-job name match.
          const wantsSubs = Array.isArray(action.assigned_subs) && action.assigned_subs.length > 0;
          if (wantsSubs && !scopeProjectId) {
            executedActions.push("Open the job (or name it) before putting a sub on a phase. No sub was added.");
          } else if (wantsSubs) {
            const subs = await resolveSubs(action.assigned_subs, executedActions);
            const added = subs.ids.filter((id) => !current.includes(id));
            if (added.length) {
              const { error: subError } = await supabase
                .from("schedule_phases")
                .update({ assigned_sub_ids: [...current, ...added], updated_at: new Date().toISOString() })
                .eq("id", targetPhase.id)
                .eq("project_id", targetPhase.project_id);
              if (subError) executedActions.push(`Could not add ${subs.names.join(", ")}: ${subError.message}`);
              else {
                revalidateSchedule(targetPhase.project_id);
                const addedNames = subs.names.filter((_, i) => added.includes(subs.ids[i]));
                executedActions.push(
                  targetPhase.is_confirmed
                    ? `${addedNames.join(", ")} ${addedNames.length === 1 ? "is" : "are"} on ${jobName} · ${targetPhase.name}; not emailed. It's already confirmed: to send the schedule email, take them off and add them again on the Job Board.`
                    : `${addedNames.join(", ")} ${addedNames.length === 1 ? "is" : "are"} on ${jobName} · ${targetPhase.name}; not emailed. Use Confirm & notify on the Job Board to send the schedule email.`,
                );
              }
            }
          }
        } else if (action.action === "delete") {
          const phaseName = (action.name as string || "").trim().toLowerCase();
          if (!phaseName) { executedActions.push("Choose the exact phase to delete."); continue; }

          let query = supabase
            .from("schedule_phases")
            .select("id, name, project_id")
            .ilike("name", `%${phaseName}%`);
          if (projectContext?.id) query = query.eq("project_id", projectContext.id);
          const { data: matchingPhases, error: matchError } = await query;
          if (matchError) { executedActions.push(`Could not find the phase: ${matchError.message}`); continue; }

          if (matchingPhases?.length === 1) {
            const target = matchingPhases![0];
            if (!target.project_id) { executedActions.push("Choose a project before deleting this event."); continue; }
            const result = await deleteSchedulePhase(target.id, target.project_id);
            executedActions.push(result.error ? `Could not delete ${target.name}: ${result.error}` : `Deleted: ${target.name}`);
          } else if ((matchingPhases?.length ?? 0) > 1) {
            executedActions.push(`More than one phase matches "${action.name}". Choose the project and exact phase before deleting.`);
          } else {
            executedActions.push(`Could not find phase "${action.name}" to delete`);
          }
        }
      } catch {
        // Skip failed actions
      }
    }

    return NextResponse.json({
      message: result.message,
      schedule_actions: actions,
      executed: executedActions,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
