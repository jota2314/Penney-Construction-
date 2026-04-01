/**
 * Tool definitions for the AI Chat assistant (Opus-powered).
 * These tools give the AI the ability to read and write to the database,
 * send emails, create todos, and more.
 */

import type Anthropic from "@anthropic-ai/sdk";

type Tool = Anthropic.Tool;

export const CHAT_TOOLS: Tool[] = [
  // ── READ / SEARCH ──────────────────────────────────────
  {
    name: "search_projects",
    description:
      "Search for projects by name, customer, address, status, or any keyword. Returns a list of matching projects with key details. Use this when the user asks about projects, wants to find a project, or needs a list.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Free text search — matches project name, customer name, address, city",
        },
        status: {
          type: "string",
          enum: ["lead", "estimating", "proposal", "contracted", "active", "completed", "on_hold", "cancelled"],
          description: "Optional filter by project status",
        },
        limit: {
          type: "number",
          description: "Max results to return (default 10, max 50)",
        },
      },
    },
  },
  {
    name: "get_project_details",
    description:
      "Get full details for a specific project — customer info, quotes, recent emails, todos, files, financials. Use after search_projects to drill into a specific project.",
    input_schema: {
      type: "object" as const,
      properties: {
        project_id: {
          type: "string",
          description: "The project UUID",
        },
      },
      required: ["project_id"],
    },
  },
  {
    name: "search_customers",
    description:
      "Search for customers/clients by name, email, phone, or address.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search term — name, email, phone, or address",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "search_subcontractors",
    description:
      "Search for subcontractors by company name, contact name, trade, email, or phone. Can filter by trade.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search term — company name, contact name, email",
        },
        trade: {
          type: "string",
          description: "Filter by trade (e.g. 'electrical', 'plumbing', 'framing')",
        },
      },
    },
  },
  {
    name: "search_emails",
    description:
      "Search stored emails by subject, sender, body text, or project. Returns matching emails with snippets.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search term — matches subject, from, body",
        },
        project_id: {
          type: "string",
          description: "Optional — filter emails linked to a specific project",
        },
        direction: {
          type: "string",
          enum: ["inbound", "outbound"],
          description: "Filter by email direction",
        },
        limit: {
          type: "number",
          description: "Max results (default 10)",
        },
      },
    },
  },
  {
    name: "get_email_details",
    description:
      "Get full details of a specific email including body text and attachment info.",
    input_schema: {
      type: "object" as const,
      properties: {
        email_id: {
          type: "string",
          description: "The email UUID from inbox_emails table",
        },
      },
      required: ["email_id"],
    },
  },
  {
    name: "list_quotes",
    description:
      "List quote requests, optionally filtered by project, subcontractor, trade, or status. Shows amounts, trades, and status.",
    input_schema: {
      type: "object" as const,
      properties: {
        project_id: {
          type: "string",
          description: "Filter by project UUID",
        },
        project_name: {
          type: "string",
          description: "Filter by project name (partial match)",
        },
        subcontractor_name: {
          type: "string",
          description: "Filter by sub name",
        },
        trade: {
          type: "string",
          description: "Filter by trade",
        },
        status: {
          type: "string",
          enum: ["pending", "received", "accepted", "rejected", "expired"],
          description: "Filter by quote status",
        },
        limit: {
          type: "number",
          description: "Max results (default 20)",
        },
      },
    },
  },
  {
    name: "list_todos",
    description:
      "List todos/follow-ups, optionally filtered by status, priority, project, or contact. Shows what needs attention.",
    input_schema: {
      type: "object" as const,
      properties: {
        status: {
          type: "string",
          enum: ["open", "done", "snoozed"],
          description: "Filter by status (default: open)",
        },
        priority: {
          type: "string",
          enum: ["high", "medium", "low"],
          description: "Filter by priority",
        },
        project_name: {
          type: "string",
          description: "Filter by project name",
        },
        limit: {
          type: "number",
          description: "Max results (default 20)",
        },
      },
    },
  },
  {
    name: "get_schedule",
    description:
      "Get schedule phases for a project — shows planned and actual dates, phase status.",
    input_schema: {
      type: "object" as const,
      properties: {
        project_id: {
          type: "string",
          description: "The project UUID",
        },
      },
      required: ["project_id"],
    },
  },

  // ── CREATE / WRITE ──────────────────────────────────────
  {
    name: "create_todo",
    description:
      "Create a new todo/follow-up item. Use when the user says things like 'remind me to...', 'follow up with...', 'I need to...', 'add a todo for...'.",
    input_schema: {
      type: "object" as const,
      properties: {
        description: {
          type: "string",
          description: "What needs to be done",
        },
        contact_name: {
          type: "string",
          description: "Who this is about (sub name, client name, etc.)",
        },
        priority: {
          type: "string",
          enum: ["high", "medium", "low"],
          description: "Priority level (default: medium)",
        },
        due_date: {
          type: "string",
          description: "Due date in YYYY-MM-DD format",
        },
        project_name: {
          type: "string",
          description: "Associated project name",
        },
        category: {
          type: "string",
          enum: ["follow_up", "quote_request", "scheduling", "document", "approval", "general"],
          description: "Todo category (default: general)",
        },
      },
      required: ["description"],
    },
  },
  {
    name: "create_project",
    description:
      "Create a new project in the system. Use when the user says 'new project', 'create a project for...', 'start a project'. Project numbers are auto-generated (PC-YYYY-NNN).",
    input_schema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Project name (usually client last name + type, e.g. 'Smith Kitchen Remodel')",
        },
        address: {
          type: "string",
          description: "Project address",
        },
        city: {
          type: "string",
          description: "City",
        },
        state: {
          type: "string",
          description: "State (default: MA)",
        },
        project_type: {
          type: "string",
          enum: ["remodel", "addition", "new_construction", "kitchen", "bathroom", "deck", "roofing", "siding", "other"],
          description: "Type of project",
        },
        status: {
          type: "string",
          enum: ["lead", "estimating", "proposal", "contracted", "active"],
          description: "Initial status (default: lead)",
        },
        description: {
          type: "string",
          description: "Brief project description",
        },
        scope_of_work: {
          type: "string",
          description: "Detailed scope of work",
        },
        estimated_value: {
          type: "number",
          description: "Estimated project value in dollars",
        },
        customer_id: {
          type: "string",
          description: "Customer UUID (if known — otherwise create customer first)",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "create_customer",
    description:
      "Create a new customer/client record. Use when a new client is mentioned that doesn't exist yet.",
    input_schema: {
      type: "object" as const,
      properties: {
        first_name: {
          type: "string",
          description: "Customer first name",
        },
        last_name: {
          type: "string",
          description: "Customer last name",
        },
        email: {
          type: "string",
          description: "Email address",
        },
        phone: {
          type: "string",
          description: "Phone number",
        },
        address: {
          type: "string",
          description: "Home address",
        },
      },
      required: ["first_name", "last_name"],
    },
  },
  {
    name: "create_quote_request",
    description:
      "Create a quote request record for tracking sub quotes on a project.",
    input_schema: {
      type: "object" as const,
      properties: {
        project_name: {
          type: "string",
          description: "Project name this quote is for",
        },
        subcontractor_name: {
          type: "string",
          description: "Name of the subcontractor",
        },
        trade: {
          type: "string",
          description: "Trade (electrical, plumbing, framing, etc.)",
        },
        amount: {
          type: "number",
          description: "Quote amount in dollars (if known)",
        },
        status: {
          type: "string",
          enum: ["pending", "received", "accepted", "rejected"],
          description: "Quote status (default: pending)",
        },
        scope_description: {
          type: "string",
          description: "Scope of work for this quote",
        },
      },
      required: ["project_name", "subcontractor_name", "trade"],
    },
  },
  {
    name: "update_todo",
    description:
      "Update an existing todo — mark as done, snooze, change priority, etc.",
    input_schema: {
      type: "object" as const,
      properties: {
        todo_id: {
          type: "string",
          description: "The todo UUID",
        },
        status: {
          type: "string",
          enum: ["open", "done", "snoozed"],
          description: "New status",
        },
        priority: {
          type: "string",
          enum: ["high", "medium", "low"],
          description: "New priority",
        },
        snooze_until: {
          type: "string",
          description: "Snooze until date (YYYY-MM-DD) — only if status is 'snoozed'",
        },
      },
      required: ["todo_id"],
    },
  },
  {
    name: "update_project",
    description:
      "Update fields on an existing project — status, description, scope, values, etc.",
    input_schema: {
      type: "object" as const,
      properties: {
        project_id: {
          type: "string",
          description: "The project UUID",
        },
        status: {
          type: "string",
          enum: ["lead", "estimating", "proposal", "contracted", "active", "completed", "on_hold", "cancelled"],
        },
        description: { type: "string" },
        scope_of_work: { type: "string" },
        estimated_value: { type: "number" },
        contract_value: { type: "number" },
        phase: { type: "string" },
      },
      required: ["project_id"],
    },
  },

  // ── EMAIL ──────────────────────────────────────
  {
    name: "draft_email",
    description:
      "Draft an email for the user to review. ALWAYS use this before send_email — never send without user approval. Format clearly with To, Subject, and Body.",
    input_schema: {
      type: "object" as const,
      properties: {
        to: {
          type: "string",
          description: "Recipient email address",
        },
        subject: {
          type: "string",
          description: "Email subject line",
        },
        body: {
          type: "string",
          description: "Email body in plain text (will be converted to HTML)",
        },
        project_name: {
          type: "string",
          description: "Associated project name for logging",
        },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "send_email",
    description:
      "Send an email via Gmail. ONLY use this AFTER the user has explicitly approved a draft. Never send without approval.",
    input_schema: {
      type: "object" as const,
      properties: {
        to: {
          type: "string",
          description: "Recipient email address",
        },
        subject: {
          type: "string",
          description: "Email subject line",
        },
        body: {
          type: "string",
          description: "Email body in plain text",
        },
        project_name: {
          type: "string",
          description: "Project name for email logging",
        },
      },
      required: ["to", "subject", "body"],
    },
  },

  // ── SCHEDULE ──────────────────────────────────────
  {
    name: "create_schedule_event",
    description:
      "Create a calendar event (meeting, walkthrough, inspection, etc.) on Google Calendar.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: {
          type: "string",
          description: "Event title",
        },
        date: {
          type: "string",
          description: "Date in YYYY-MM-DD format",
        },
        start_time: {
          type: "string",
          description: "Start time in HH:MM format (24h)",
        },
        end_time: {
          type: "string",
          description: "End time in HH:MM format (24h)",
        },
        location: {
          type: "string",
          description: "Event location/address",
        },
        description: {
          type: "string",
          description: "Event description/notes",
        },
        attendees: {
          type: "array",
          items: { type: "string" },
          description: "Email addresses of attendees",
        },
      },
      required: ["title", "date", "start_time"],
    },
  },
  {
    name: "create_schedule_phase",
    description:
      "Add a schedule phase to a project (e.g. 'Framing', 'Rough Electrical', 'Drywall'). For project timeline planning.",
    input_schema: {
      type: "object" as const,
      properties: {
        project_id: {
          type: "string",
          description: "The project UUID",
        },
        phase_name: {
          type: "string",
          description: "Name of the phase (e.g. 'Demo', 'Framing', 'Electrical Rough')",
        },
        planned_start: {
          type: "string",
          description: "Planned start date (YYYY-MM-DD)",
        },
        planned_end: {
          type: "string",
          description: "Planned end date (YYYY-MM-DD)",
        },
        notes: {
          type: "string",
          description: "Notes about this phase",
        },
      },
      required: ["project_id", "phase_name"],
    },
  },
];
