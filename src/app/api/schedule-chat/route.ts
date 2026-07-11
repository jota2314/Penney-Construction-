import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getAnthropicClient,
  CLAUDE_FALLBACK_MODELS,
  logAiUsage,
} from "@/lib/ai/claude";
import { buildSchedulePrompt } from "@/lib/ai/prompts/schedule";
import { loadScheduleContext } from "@/lib/ai/shared-context";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { messages: chatHistory, userMessage, projectContext, execute } = await request.json();
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
          // Creates only run server-side when the caller opts in (the global
          // Schedule Assistant panel, which has no approve button). The
          // project "Plan with AI" tab omits `execute` and inserts proposals
          // itself when the user taps "Add N Phases" — running them here too
          // put every planned phase on the schedule twice.
          if (!execute) continue;
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
              await supabase.from("schedule_phases").insert({
                project_id: projectId,
                name: (action.name as string) || "Scheduled work",
                start_date: action.start_date as string,
                end_date: action.end_date as string || action.start_date as string,
                planned_start_date: action.start_date as string,
                planned_end_date: action.end_date as string || action.start_date as string,
                status: "not_started",
                assigned_employee_ids: assignedIds,
                notes: (action.notes as string) || null,
                event_type: (action.event_type as string) || "phase",
                sort_order: 0,
                color: action.event_type === "inspection" ? "#ef4444" : action.event_type === "walkthrough" ? "#f59e0b" : "#8b5cf6",
                created_by: user.id,
              });
              executedActions.push(`Created: ${action.name} on ${action.start_date}`);
            }
          }
        } else if (action.action === "update") {
          // Find existing phase by name (fuzzy match)
          const phaseName = (action.name as string || "").toLowerCase();
          const projectName = (action.project_name as string || "").toLowerCase();

          // Search in current phases
          const { data: matchingPhases } = await supabase
            .from("schedule_phases")
            .select("id, name, project_id, start_date, end_date")
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
            const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
            if (action.start_date) updates.start_date = action.start_date;
            if (action.end_date) updates.end_date = action.end_date;
            if (action.status) updates.status = action.status;
            if (action.notes) updates.notes = action.notes;

            await supabase.from("schedule_phases").update(updates).eq("id", targetPhase.id);
            executedActions.push(`Updated: ${targetPhase.name} → ${action.start_date || targetPhase.start_date} to ${action.end_date || targetPhase.end_date}`);
          } else {
            executedActions.push(`Could not find phase "${action.name}" to update`);
          }
        } else if (action.action === "delete") {
          const phaseName = (action.name as string || "").toLowerCase();

          const { data: matchingPhases } = await supabase
            .from("schedule_phases")
            .select("id, name")
            .ilike("name", `%${phaseName}%`);

          if ((matchingPhases ?? []).length > 0) {
            const target = matchingPhases![0];
            await supabase.from("schedule_phases").delete().eq("id", target.id);
            executedActions.push(`Deleted: ${target.name}`);
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
