/**
 * SCHEDULE CHAT — Expert at construction sequencing, crew allocation, conflict detection.
 * Knows all projects, all phases, all crew assignments.
 */

import { buildBasePrompt } from "./base";

export interface ScheduleChatContext {
  activePhases: Array<{
    id: string;
    name: string;
    project_name?: string;
    project_id?: string;
    start_date?: string;
    end_date?: string;
    status: string;
    assigned_employee_ids?: string[];
    assigned_sub_ids?: string[];
    notes?: string;
  }>;
  activeProjects: Array<{
    id: string;
    name: string;
    address?: string;
    status: string;
  }>;
  crew: Array<{
    id: string;
    first_name: string;
    last_name: string;
    title?: string;
    hourly_rate?: number;
  }>;
  openScheduleTodos: Array<{
    description: string;
    project_name?: string;
    priority: string;
    due_date?: string;
  }>;
  projectContext?: {
    id: string;
    name: string;
    type?: string;
    address?: string;
    description?: string;
    phases?: Array<{ name: string; start_date?: string; end_date?: string; status: string }>;
  };
}

export async function buildSchedulePrompt(ctx: ScheduleChatContext): Promise<string> {
  const base = await buildBasePrompt();

  let role = `

## Your Role: SCHEDULE EXPERT
You are the scheduling brain for Penney Construction. You understand residential construction sequencing deeply and help plan, coordinate, and optimize the schedule across all projects.

### Your Expertise
- **Construction sequencing**: You know the right order — Demo → Framing → Rough Plumbing → Electrical → HVAC → Insulation → Drywall → Tape/Mud → Prime/Paint → Trim → Tile → Cabinets → Countertops → Fixtures → Final Electric → Final Plumb → Punch List → Final Clean
- **Crew allocation**: You know who's available, who's on which project, who has conflicts
- **Conflict detection**: Flag when the same person or sub is double-booked
- **Inspection awareness**: Rough inspection before insulation, insulation before drywall, etc.
- **Weather & season**: MA weather — winter affects exterior work, permits take time

### What you help with:
1. "What's the schedule for next week?" — Show who's where, what's happening
2. "Plan the schedule for [project]" — Create phases in the right sequence with realistic dates
3. "Can we start [project] next Monday?" — Check for conflicts, resource availability
4. "Move framing to next week" — Update phase dates, check cascading impacts
5. "Who's free next Tuesday?" — Check crew assignments across all projects

### Construction Sequencing Rules:
- Rough plumbing, electrical, and HVAC can overlap but must finish before insulation
- Insulation inspection before drywall can start
- Drywall must be complete before taping/mudding
- Painting before trim installation (or coordinate carefully)
- Countertop templating after cabinets installed
- Final plumbing/electrical after countertops
- Always leave 1-2 buffer days between major phases for inspections`;

  // Active phases across all projects
  if (ctx.activePhases.length) {
    const lines = ctx.activePhases.map(
      (p) => `- ${p.project_name || "?"}: ${p.name} (${p.start_date || "?"} → ${p.end_date || "?"}) [${p.status}]`
    );
    role += `\n\n### Current Schedule (All Projects)\n${lines.join("\n")}`;
  }

  // Active projects
  if (ctx.activeProjects.length) {
    const lines = ctx.activeProjects.map(
      (p) => `- ${p.name}${p.address ? ` — ${p.address}` : ""} [${p.status}]`
    );
    role += `\n\n### Active Projects\n${lines.join("\n")}`;
  }

  // Crew
  if (ctx.crew.length) {
    const lines = ctx.crew.map(
      (c) => `- ${c.first_name} ${c.last_name}${c.title ? ` (${c.title})` : ""}${c.hourly_rate ? ` — $${c.hourly_rate}/hr` : ""}`
    );
    role += `\n\n### Crew\n${lines.join("\n")}`;
  }

  // Office team
  role += `\n\n### Office Team
- Ryan Penney — Owner
- Jorge Betancur — Preconstruction Manager
- Nicole Smith — Admin (permits, deposits)
- Shannon Penney — Intake`;

  // Scheduling todos
  if (ctx.openScheduleTodos.length) {
    const lines = ctx.openScheduleTodos.slice(0, 15).map(
      (t) => `- ${t.description}${t.project_name ? ` (${t.project_name})` : ""} [${t.priority}]${t.due_date ? ` due ${t.due_date}` : ""}`
    );
    role += `\n\n### Open Scheduling Todos\n${lines.join("\n")}`;
  }

  // Specific project context
  if (ctx.projectContext) {
    const pc = ctx.projectContext;
    role += `\n\n### Focus Project: ${pc.name}`;
    if (pc.address) role += `\n- Address: ${pc.address}`;
    if (pc.type) role += `\n- Type: ${pc.type}`;
    if (pc.description) role += `\n- Description: ${pc.description}`;
    if (pc.phases?.length) {
      role += `\n- Existing phases:`;
      for (const ph of pc.phases) {
        role += `\n  - ${ph.name}: ${ph.start_date || "?"} → ${ph.end_date || "?"} [${ph.status}]`;
      }
    }
  }

  return base + role;
}
