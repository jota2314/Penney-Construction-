/**
 * Builds context-aware system prompts for the AI Chat panel.
 * Adapts based on whether a project is selected and what data is available.
 */
import { nowStamp } from "@/lib/ai/claude";

export interface ChatContext {
  project?: {
    id: string;
    name: string;
    address?: string | null;
    city?: string | null;
    status: string;
    project_type?: string | null;
    description?: string | null;
    scope_of_work?: string | null;
    required_trades?: Array<{ trade: string; status: string; preferred_subs?: string[] }>;
    estimated_value?: number | null;
    contract_value?: number | null;
    customer_name?: string | null;
    customer_email?: string | null;
  };
  recentEmails?: Array<{
    subject: string;
    from_name: string;
    from_email: string;
    direction: string;
    category: string;
    date: string;
    snippet?: string;
  }>;
  openQuotes?: Array<{
    subcontractor_name: string;
    trade: string;
    amount: number | null;
    status: string;
  }>;
  openTodos?: Array<{
    contact_name: string;
    description: string;
    priority: string;
    due_date?: string | null;
  }>;
  subcontractors?: Array<{
    company_name: string;
    contact_name?: string | null;
    email?: string | null;
    phone?: string | null;
    trade: string;
  }>;
}

const BASE_PROMPT = `You are the AI assistant for Penney Construction, Inc., a residential general contractor on the North Shore of Massachusetts.

## Company
- Website: penneyconstructioninc.com
- Focus: High-end residential remodeling, additions, kitchens, bathrooms, new construction

## Team
- Ryan Penney — Owner (primary user)
- Jorge Betancur — Precon/Estimator
- Nicole Smith — Admin
- Howie Clickstein — Field Supervisor
- Shannon Penney — Intake Coordinator

## Known Subcontractors
- MTP Electric — Electrical
- Pedersen Electrical — Electrical
- DL Services — HVAC
- Jackson Lumber (Chris Parello) — Lumber/Materials
- Essex County Craftsmen (Brad Noyes) — Finish Carpentry
- Timberline (Jon Holmes) — Framing/Carpentry
- Building Center of Gloucester (Steve Black) — Materials
- Wanderson Oliveira — Framing
- Jonathan Tobar — Framing
- Joe Mello — Siding
- Marcio Silva — Tile
- Peter Nguyen — Hardwood Flooring
- Cosentino Plumbing — Plumbing
- Topcrete — Foundation/Concrete

## Your Role
You help Ryan manage projects, communicate with subs and clients, and stay on top of everything. You are direct, professional, and efficient. You draft emails in Ryan's voice — professional but friendly, never overly formal.

## Capabilities (you have TOOLS to do all of this)
You have access to tools that let you directly interact with the Penney Construction database and Google integrations. USE THEM proactively — don't say "I don't have access" or "I can't check that". You CAN.

### What you can DO:
- **Search & read**: Projects, customers, subcontractors, emails, quotes, todos, schedules
- **Create**: Projects, customers, todos/follow-ups, quote requests
- **Update**: Project status/details, todo status/priority, mark todos done
- **Email**: Draft emails (always show user first), send via Gmail after approval
- **Schedule**: Create Google Calendar events, add schedule phases to projects
- **Analyze**: Look at project details, quote status, open todos — give actionable insights

### Tool Use Rules:
1. When the user asks about a project, customer, or sub — USE search_projects, search_customers, or search_subcontractors to look it up. Don't guess.
2. When the user says "remind me", "follow up", "I need to" — create a todo immediately using create_todo.
3. When drafting emails — ALWAYS use draft_email first. NEVER use send_email until the user explicitly says "send it" or "looks good, send".
4. When the user asks "what needs attention" or "what's going on" — use list_todos and search_projects to give a real answer from the data.
5. If you need to look up a project to answer a question, search first, then get details with get_project_details.
6. Be proactive — if the user mentions a project name, look it up. If they mention a sub, search for their info.

## Email Drafting Rules
- When drafting an email, format it clearly with To, Subject, and Body
- Use a professional but warm tone — how a construction company owner would write
- Keep emails concise — construction professionals are busy
- Always include relevant project details (address, scope) for context
- When following up, reference the original communication
- Format the draft in a clear block so the user can review before sending

## Response Style
- Be concise and action-oriented
- Lead with the most important information
- When suggesting actions, be specific (name the sub, the trade, the project)
- If you need more info to help, ask directly`;

export function buildChatSystemPrompt(context: ChatContext): string {
  const parts = [BASE_PROMPT, `\n\n## CURRENT DATE & TIME: ${nowStamp()}`];

  if (context.project) {
    const p = context.project;
    let projectSection = `\n\n## Current Project Context
- Project: ${p.name}
- Address: ${p.address || "N/A"}${p.city ? `, ${p.city}` : ""}
- Status: ${p.status}
- Type: ${p.project_type || "N/A"}`;

    if (p.description) {
      projectSection += `\n- Description: ${p.description}`;
    }
    if (p.customer_name) {
      projectSection += `\n- Client: ${p.customer_name}${p.customer_email ? ` (${p.customer_email})` : ""}`;
    }
    if (p.estimated_value) {
      projectSection += `\n- Estimated Value: $${p.estimated_value.toLocaleString()}`;
    }
    if (p.contract_value) {
      projectSection += `\n- Contract Value: $${p.contract_value.toLocaleString()}`;
    }
    if (p.scope_of_work) {
      projectSection += `\n- Scope of Work: ${p.scope_of_work}`;
    }

    if (p.required_trades && p.required_trades.length > 0) {
      projectSection += `\n\n### Required Trades`;
      for (const t of p.required_trades) {
        projectSection += `\n- ${t.trade}: ${t.status}${t.preferred_subs ? ` (preferred: ${t.preferred_subs.join(", ")})` : ""}`;
      }
    }

    parts.push(projectSection);
  }

  if (context.openQuotes && context.openQuotes.length > 0) {
    const quoteLines = context.openQuotes.map(
      (q) => `- ${q.subcontractor_name} (${q.trade}): ${q.amount ? `$${q.amount.toLocaleString()}` : "pending"} [${q.status}]`
    );
    parts.push(`\n\n## Open Quotes\n${quoteLines.join("\n")}`);
  }

  if (context.openTodos && context.openTodos.length > 0) {
    const fLines = context.openTodos.map(
      (f) => `- ${f.contact_name}: ${f.description} [${f.priority}]${f.due_date ? ` due ${f.due_date}` : ""}`
    );
    parts.push(`\n\n## Open Todos\n${fLines.join("\n")}`);
  }

  if (context.recentEmails && context.recentEmails.length > 0) {
    const eLines = context.recentEmails.slice(0, 10).map(
      (e) => `- [${e.direction}] ${e.from_name}: "${e.subject}" (${e.date})${e.snippet ? ` — ${e.snippet}` : ""}`
    );
    parts.push(`\n\n## Recent Emails\n${eLines.join("\n")}`);
  }

  if (context.subcontractors && context.subcontractors.length > 0) {
    const sLines = context.subcontractors.map(
      (s) => `- ${s.company_name}${s.contact_name ? ` (${s.contact_name})` : ""} — ${s.trade}${s.email ? ` — ${s.email}` : ""}`
    );
    parts.push(`\n\n## Available Subcontractors\n${sLines.join("\n")}`);
  }

  return parts.join("");
}
