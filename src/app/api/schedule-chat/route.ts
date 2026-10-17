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
      "notes": "Details",
      "status": "not_started" | "in_progress" | "completed" | "on_hold",
      "event_type": "phase" | "meeting" | "walkthrough" | "inspection"
    }
  ]
}

IMPORTANT FOR UPDATES:
- To update: "action": "update", "name" matches existing phase name
- To delete: "action": "delete", "name" matches existing phase name
- Be conversational and practical — think like a construction superintendent`;

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
                notes: (action.notes as string) || null,
                event_type: (action.event_type as string) || "phase",
                sort_order: 0,
                color: action.event_type === "inspection" ? "#ef4444" : action.event_type === "walkthrough" ? "#f59e0b" : "#8b5cf6",
                created_by: user.id,
              });
              if (createError) executedActions.push(`Could not create ${action.name}: ${createError.message}`);
              else { revalidateSchedule(projectId); executedActions.push(`Created: ${action.name} on ${action.start_date}`); }
            }
          }
        } else if (action.action === "update") {
          // Find existing phase by name (fuzzy match)
          const phaseName = (action.name as string || "").toLowerCase();
          const projectName = (action.project_name as string || "").toLowerCase();

          // Search in current phases
          const { data: matchingPhases } = await supabase
            .from("schedule_phases")
            .select("id, name, project_id, start_date, end_date, is_confirmed")
            .ilike("name", `%${phaseName}%`);

          let targetPhase = (matchingPhases ?? [])[0];

          // If multiple matches, prefer one matching the project
          if ((matchingPhases ?? []).length > 1 && projectName) {
            const projMatch = projects.find((p) => p.name.toLowerCase().includes(projectName));
            if (projMatch) {
              const better = (matchingPhases ?? []).find((p) => p.project_id === projMatch.id);
              if (better) targetPhase = better;
            }
          }

          if (targetPhase) {
            if (!targetPhase.project_id) { executedActions.push("Choose a project before updating this event."); continue; }
            const result = await updateSchedulePhase(targetPhase.id, {
              project_id: targetPhase.project_id,
              ...(action.start_date ? { start_date: String(action.start_date) } : {}),
              ...(action.end_date ? { end_date: String(action.end_date) } : {}),
              ...(action.start_date || action.end_date ? { is_manually_scheduled: true } : {}),
              ...(action.status ? { status: String(action.status) } : {}),
              ...(action.notes ? { notes: String(action.notes) } : {}),
            });
            if (result.error) executedActions.push(`Could not update ${targetPhase.name}: ${result.error}`);
            else {
              executedActions.push(`Updated: ${targetPhase.name} → ${action.start_date || targetPhase.start_date} to ${action.end_date || targetPhase.end_date}`);
              if (result.notify?.emailed.length) executedActions.push(`Emailed schedule update to: ${result.notify.emailed.join(", ")}`);
            }
          } else {
            executedActions.push(`Could not find phase "${action.name}" to update`);
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
