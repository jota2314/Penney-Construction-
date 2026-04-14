/**
 * PROJECT CHAT — Expert on ONE specific project.
 * Loaded with full project context: customer, quotes, emails, budget, schedule, todos.
 */

import { buildBasePrompt } from "./base";

export interface ProjectChatContext {
  project: {
    id: string;
    project_number?: string;
    name: string;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    status: string;
    project_type?: string | null;
    description?: string | null;
    scope_of_work?: string | null;
    estimated_value?: number | null;
    contract_value?: number | null;
    phase?: string | null;
    next_action?: string | null;
    required_trades?: unknown;
  };
  customer?: {
    name: string;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
  } | null;
  quotes?: Array<{
    subcontractor_name: string;
    trade: string;
    amount: number | null;
    status: string;
  }>;
  todos?: Array<{
    description: string;
    priority: string;
    contact_name: string;
    due_date?: string | null;
    status: string;
  }>;
  emails?: Array<{
    subject: string;
    from: string;
    direction: string;
    date: string;
    snippet?: string;
  }>;
  schedule?: Array<{
    name: string;
    start_date?: string;
    end_date?: string;
    status: string;
  }>;
}

export async function buildProjectPrompt(ctx: ProjectChatContext): Promise<string> {
  const base = await buildBasePrompt();
  const p = ctx.project;

  let role = `

## Your Role: PROJECT EXPERT
You are the dedicated AI for the **${p.name}** project. You know every detail about this job — every email, every quote, every dollar, every phase.

### CRITICAL: Project ID
**project_id: ${p.id}**
ALWAYS use this exact project_id for ALL tool calls (create_invoice, create_change_order, split_invoice, get_budget_lines, etc.). NEVER make up a UUID — use "${p.id}".

### Project Details
- **Project**: ${p.name}${p.project_number ? ` (${p.project_number})` : ""}
- **Project ID**: \`${p.id}\`
- **Address**: ${p.address || "TBD"}${p.city ? `, ${p.city}` : ""}${p.state ? `, ${p.state}` : ""}
- **Status**: ${p.status}
- **Type**: ${p.project_type || "N/A"}`;

  if (p.description) role += `\n- **Description**: ${p.description}`;
  if (p.scope_of_work) role += `\n- **Scope**: ${p.scope_of_work}`;
  if (p.estimated_value) role += `\n- **Estimated Value**: $${p.estimated_value.toLocaleString()}`;
  if (p.contract_value) role += `\n- **Contract Value**: $${p.contract_value.toLocaleString()}`;
  if (p.phase) role += `\n- **Current Phase**: ${p.phase}`;
  if (p.next_action) role += `\n- **Next Action**: ${p.next_action}`;

  if (ctx.customer) {
    role += `\n\n### Client
- **Name**: ${ctx.customer.name}
- **Email**: ${ctx.customer.email || "N/A"}
- **Phone**: ${ctx.customer.phone || "N/A"}`;
  }

  if (ctx.quotes?.length) {
    const lines = ctx.quotes.map(
      (q) => `- ${q.subcontractor_name} (${q.trade}): ${q.amount ? `$${q.amount.toLocaleString()}` : "pending"} [${q.status}]`
    );
    role += `\n\n### Quotes\n${lines.join("\n")}`;
  }

  if (ctx.todos?.length) {
    const openTodos = ctx.todos.filter(t => t.status === "open");
    if (openTodos.length) {
      const lines = openTodos.map(
        (t) => `- ${t.contact_name}: ${t.description} [${t.priority}]${t.due_date ? ` due ${t.due_date}` : ""}`
      );
      role += `\n\n### Open Todos\n${lines.join("\n")}`;
    }
  }

  if (ctx.emails?.length) {
    const lines = ctx.emails.slice(0, 10).map(
      (e) => `- [${e.direction}] ${e.from}: "${e.subject}" (${e.date})`
    );
    role += `\n\n### Recent Emails\n${lines.join("\n")}`;
  }

  if (ctx.schedule?.length) {
    const lines = ctx.schedule.map(
      (s) => `- ${s.name}: ${s.start_date || "TBD"} → ${s.end_date || "TBD"} [${s.status}]`
    );
    role += `\n\n### Schedule\n${lines.join("\n")}`;
  }

  role += `

### What makes you special:
- You are deeply loaded with THIS project's context — use it to give precise answers
- When asked "what's the status?" — summarize current phase, recent activity, upcoming work
- When asked about budget — use get_project_financials for live numbers
- When drafting emails about this project — include the project address, scope details, specific dates
- Flag overdue todos, missing quotes, or budget overruns proactively
- Know the full email history — reference past communications when relevant`;

  return base + role;
}
