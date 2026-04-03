import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getAnthropicClient,
  CLAUDE_FALLBACK_MODELS,
  nowStamp,
  logAiUsage,
} from "@/lib/ai/claude";

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

    // Load all schedule context in parallel
    const [
      phasesRes,
      projectsRes,
      employeesRes,
      todosRes,
    ] = await Promise.all([
      // All schedule phases (current and upcoming)
      supabase
        .from("schedule_phases")
        .select("id, name, description, start_date, end_date, status, assigned_employee_ids, notes, project_id, color, event_type")
        .in("status", ["not_started", "in_progress", "on_hold"])
        .order("start_date"),
      // Active projects
      supabase
        .from("projects")
        .select("id, name, project_number, address, city, status, phase, description")
        .in("status", ["contracted", "in_progress", "estimating", "proposal_sent"])
        .order("name"),
      // Employees
      supabase
        .from("employees")
        .select("id, first_name, last_name, title, phone, hourly_rate")
        .eq("status", "active")
        .order("last_name"),
      // Open todos (scheduling-related)
      supabase
        .from("todos")
        .select("description, project_name, priority, category, assignee, due_date")
        .eq("status", "open")
        .in("category", ["scheduling", "materials", "permits_inspections", "general"])
        .order("priority", { ascending: false })
        .limit(20),
    ]);

    const phases = phasesRes.data ?? [];
    const projects = projectsRes.data ?? [];
    const employees = employeesRes.data ?? [];
    const todos = todosRes.data ?? [];

    // Build project lookup
    const projectMap = new Map(projects.map((p) => [p.id, p]));

    // Build schedule context
    const scheduleContext = phases.length > 0
      ? phases
          .map((p) => {
            const proj = p.project_id ? projectMap.get(p.project_id) : null;
            const projName = proj ? proj.name : "No project";
            const location = proj ? [proj.address, proj.city].filter(Boolean).join(", ") : "";
            return `- [${p.status}] ${p.name} | ${projName}${location ? ` | ${location}` : ""} | ${p.start_date} to ${p.end_date}${p.notes ? ` | Notes: ${p.notes}` : ""}${p.event_type ? ` | Type: ${p.event_type}` : ""}`;
          })
          .join("\n")
      : "No scheduled phases";

    const projectsContext = projects
      .map((p) => `- ${p.name} [${p.status}] ${p.address || ""}, ${p.city || ""} — ${p.description?.substring(0, 100) || ""}`)
      .join("\n") || "No active projects";

    const crewContext = employees
      .map((e) => `- ${e.first_name} ${e.last_name} | ${e.title} | $${e.hourly_rate}/hr${e.phone ? ` | ${e.phone}` : ""} | ID: ${e.id}`)
      .join("\n") || "No employees";

    const todosContext = todos
      .map((t) => `- [${t.priority}] ${t.description}${t.project_name ? ` (${t.project_name})` : ""}${t.assignee ? ` → ${t.assignee}` : ""}${t.due_date ? ` due ${t.due_date}` : ""}`)
      .join("\n") || "No scheduling todos";

    const systemPrompt = `You are the AI scheduling assistant for Penney Construction, a residential GC on the North Shore of Massachusetts.

## ${nowStamp()}

You're helping plan construction schedules. You understand residential construction sequencing deeply.
Your job: help plan phases, organize who goes where, and make sure the schedule makes sense.${
      projectContext
        ? `

## PLANNING FOR SPECIFIC PROJECT
Project: ${projectContext.name}
Type: ${projectContext.type || "remodel"}
Address: ${projectContext.address || "N/A"}
Description: ${projectContext.description || "N/A"}
Existing phases: ${projectContext.existingPhases?.length > 0 ? projectContext.existingPhases.join("\n") : "None — fresh schedule needed"}

When creating phases for this project, use realistic construction sequencing:
- Typical residential order: Demo → Framing → Rough Plumbing → Rough Electric → HVAC → Insulation → Drywall → Tape/Mud → Prime/Paint → Trim → Tile → Cabinets → Countertops → Fixtures → Final Electric → Final Plumb → Punch List → Final Clean
- Not all projects need all phases — match to the project type and scope
- Each phase should have realistic durations (demo: 2-3 days, framing: 1-2 weeks, etc.)
- Use the project_name field in schedule_actions to match this project`
        : ""
    }

## CURRENT SCHEDULE (active phases)
${scheduleContext}

## ACTIVE PROJECTS
${projectsContext}

## CREW
${crewContext}

Office team: Ryan Penney (Owner), Jorge Betancur (Estimator), Nicole Smith (Admin), Howie Clickstein (Field), Shannon Penney (Intake)

## OPEN SCHEDULING TODOS
${todosContext}

## WHAT YOU CAN DO
- Help plan next week: who goes to which job site, what days
- Identify conflicts: two jobs need the same person, overlapping schedules
- Suggest crew assignments based on project needs and skills
- Flag what's missing: permits not pulled, materials not ordered, inspections not scheduled
- Create schedule entries for next week
- Track what got done this week and what carries over

## RESPONSE FORMAT
Return a JSON object:
{
  "message": "Your conversational response — be specific about scheduling",
  "schedule_actions": [
    {
      "action": "create" | "update" | "delete",
      "name": "Phase/event name (for create) or existing phase name to match (for update/delete)",
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
- To update an existing phase, use "action": "update" and set "name" to match the existing phase name
- You can update: start_date, end_date, status, notes, assigned_to
- Example: user says "change framing to end on the 17th" → { "action": "update", "name": "Framing Phase", "end_date": "2026-04-17" }
- To delete a phase: { "action": "delete", "name": "Phase Name" }
- Be conversational and practical — think like a construction superintendent
- Keep responses focused on scheduling and logistics`;

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
