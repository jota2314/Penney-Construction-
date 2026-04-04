/**
 * Shared tool definitions for ALL 4 AI chats.
 * Single source of truth — Brain, Project, Email Triage, and Schedule chats all use these.
 *
 * Tools are split into:
 * - READ_TOOLS: auto-execute, no user approval needed
 * - WRITE_TOOLS: require user approval before execution
 */

import type Anthropic from "@anthropic-ai/sdk";

type Tool = Anthropic.Tool;

// ── READ / SEARCH tools (auto-execute) ──────────────────────

export const READ_TOOLS: Tool[] = [
  {
    name: "search_projects",
    description:
      "Search for projects by name, customer, address, status, or any keyword. Returns matching projects with key details.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Free text search — matches project name, customer name, address, city",
        },
        status: {
          type: "string",
          enum: ["lead", "estimating", "proposal_sent", "contracted", "in_progress", "completed", "cancelled"],
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
      "Get full details for a specific project — customer info, quotes, recent emails, todos, files, financials, schedule.",
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
    name: "get_project_financials",
    description:
      "Get LIVE financial data for a project — budget vs actual costs, labor hours, payments received, change orders, profit, margin. Call this when asked about money, budget, costs, profit, or financial health of a project.",
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
    name: "get_budget_vs_actual",
    description:
      "Get per-line-item budget breakdown — shows budgeted cost vs actual invoiced for each estimate line. Use when asked about specific cost overruns or line-item tracking.",
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
    description: "Search for customers/clients by name, email, phone, or address.",
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
      "Search for subcontractors by company name, contact name, trade, email, or phone.",
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
        limit: { type: "number", description: "Max results (default 10)" },
      },
    },
  },
  {
    name: "get_email_details",
    description: "Get full details of a specific email including body text and attachment info.",
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
      "List quote requests, optionally filtered by project, subcontractor, trade, or status.",
    input_schema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "Filter by project UUID" },
        project_name: { type: "string", description: "Filter by project name (partial match)" },
        subcontractor_name: { type: "string", description: "Filter by sub name" },
        trade: { type: "string", description: "Filter by trade" },
        status: {
          type: "string",
          enum: ["just_sent", "awaiting_reply", "received", "in_progress", "accepted", "declined", "approved"],
          description: "Filter by quote status",
        },
        limit: { type: "number", description: "Max results (default 20)" },
      },
    },
  },
  {
    name: "list_todos",
    description: "List todos/follow-ups, optionally filtered by status, priority, project, or category.",
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
          enum: ["low", "medium", "high", "urgent"],
          description: "Filter by priority",
        },
        project_name: { type: "string", description: "Filter by project name" },
        category: {
          type: "string",
          enum: ["quotes", "estimates", "scheduling", "follow_up_quotes", "follow_up_clients", "permits_inspections", "materials", "change_orders", "payments", "contracts_docs", "general"],
          description: "Filter by category",
        },
        limit: { type: "number", description: "Max results (default 20)" },
      },
    },
  },
  {
    name: "get_schedule",
    description: "Get schedule phases for a project or all projects. Shows dates, status, assignments.",
    input_schema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "Optional project UUID — omit for all active" },
      },
    },
  },
  {
    name: "list_invoices",
    description: "List vendor invoices for a project — shows amounts, payment status, vendors, trades.",
    input_schema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "Filter by project UUID" },
        payment_status: {
          type: "string",
          enum: ["unpaid", "partial", "paid"],
          description: "Filter by payment status",
        },
        limit: { type: "number", description: "Max results (default 20)" },
      },
    },
  },
  {
    name: "list_payments",
    description: "List payments received from clients for a project — deposits, draws, final payments.",
    input_schema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "Filter by project UUID" },
        limit: { type: "number", description: "Max results (default 20)" },
      },
    },
  },
  {
    name: "list_change_orders",
    description: "List change orders for a project — shows cost/price impact, status.",
    input_schema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "Filter by project UUID" },
        status: {
          type: "string",
          enum: ["draft", "submitted", "approved", "rejected", "void"],
        },
      },
    },
  },
];

// ── WRITE tools (require user approval) ────────────────────

export const WRITE_TOOLS: Tool[] = [
  {
    name: "create_todo",
    description:
      "Create a personal reminder/todo for the current user. Use when they say 'remind me', 'I need to', 'follow up with', 'add a todo'. These are SELF-REMINDERS — never assign to other people.",
    input_schema: {
      type: "object" as const,
      properties: {
        description: { type: "string", description: "What I need to do" },
        contact_name: { type: "string", description: "Who this is about (sub, client, vendor)" },
        priority: {
          type: "string",
          enum: ["low", "medium", "high", "urgent"],
          description: "Priority level (default: medium)",
        },
        due_date: { type: "string", description: "Due date YYYY-MM-DD" },
        project_name: { type: "string", description: "Associated project name" },
        category: {
          type: "string",
          enum: ["quotes", "estimates", "scheduling", "follow_up_quotes", "follow_up_clients", "permits_inspections", "materials", "change_orders", "payments", "contracts_docs", "general"],
          description: "Todo category",
        },
      },
      required: ["description"],
    },
  },
  {
    name: "update_todo",
    description: "Update a todo — mark as done, snooze, change priority.",
    input_schema: {
      type: "object" as const,
      properties: {
        todo_id: { type: "string", description: "The todo UUID" },
        status: { type: "string", enum: ["open", "done", "snoozed"] },
        priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
        snooze_until: { type: "string", description: "Snooze date YYYY-MM-DD" },
      },
      required: ["todo_id"],
    },
  },
  {
    name: "create_project",
    description:
      "Create a new project. Project numbers auto-generate (PC-YYYY-NNN). Name format: 'ClientLastName ProjectType'.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Project name (e.g. 'Smith Kitchen Remodel')" },
        address: { type: "string" },
        city: { type: "string" },
        state: { type: "string", description: "Default: MA" },
        project_type: {
          type: "string",
          enum: ["remodel", "addition", "new_construction", "kitchen", "bathroom", "deck", "roofing", "siding", "other"],
        },
        status: {
          type: "string",
          enum: ["lead", "estimating", "proposal_sent", "contracted", "in_progress"],
          description: "Default: lead",
        },
        description: { type: "string" },
        scope_of_work: { type: "string" },
        estimated_value: { type: "number" },
        customer_id: { type: "string", description: "Customer UUID if known" },
      },
      required: ["name"],
    },
  },
  {
    name: "update_project",
    description: "Update fields on an existing project.",
    input_schema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "Project UUID" },
        status: {
          type: "string",
          enum: ["lead", "estimating", "proposal_sent", "contracted", "in_progress", "completed", "cancelled"],
        },
        description: { type: "string" },
        scope_of_work: { type: "string" },
        estimated_value: { type: "number" },
        contract_value: { type: "number" },
        phase: { type: "string" },
        next_action: { type: "string" },
      },
      required: ["project_id"],
    },
  },
  {
    name: "create_customer",
    description: "Create a new customer/client record.",
    input_schema: {
      type: "object" as const,
      properties: {
        first_name: { type: "string" },
        last_name: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        address: { type: "string" },
        city: { type: "string" },
        state: { type: "string" },
        zip: { type: "string" },
      },
      required: ["first_name", "last_name"],
    },
  },
  {
    name: "create_subcontractor",
    description:
      "Create a new subcontractor/vendor. IMPORTANT: First search_subcontractors to check if they already exist. Fuzzy match by contact name, company, email, and nicknames (Chuck=Charles, etc).",
    input_schema: {
      type: "object" as const,
      properties: {
        company_name: { type: "string" },
        contact_name: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        trades: {
          type: "array",
          items: { type: "string" },
          description: "Array of trades (e.g. ['Electrical', 'HVAC'])",
        },
        address: { type: "string" },
        city: { type: "string" },
        state: { type: "string" },
      },
      required: ["company_name"],
    },
  },
  {
    name: "create_quote_request",
    description: "Create a quote request record for tracking sub quotes on a project.",
    input_schema: {
      type: "object" as const,
      properties: {
        project_name: { type: "string", description: "Project name" },
        subcontractor_name: { type: "string" },
        trade: { type: "string" },
        amount: { type: "number", description: "Quote amount if known" },
        status: {
          type: "string",
          enum: ["just_sent", "awaiting_reply", "received", "accepted", "declined", "approved"],
          description: "Default: received",
        },
        scope_description: { type: "string" },
        extracted_text: { type: "string", description: "Full text extracted from quote PDF" },
        gmail_message_id: { type: "string", description: "Source email ID" },
        attachment_storage_path: { type: "string", description: "Path to PDF in storage" },
        document_type: {
          type: "string",
          enum: ["quote", "invoice", "change_order", "estimate", "permit", "contract", "other"],
          description: "Default: quote",
        },
      },
      required: ["project_name", "subcontractor_name", "trade"],
    },
  },
  {
    name: "create_invoice",
    description:
      "Record a vendor/sub invoice against a project. Links to budget line if estimate_line_item_id provided.",
    input_schema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "Project UUID" },
        vendor_name: { type: "string" },
        vendor_type: { type: "string", enum: ["subcontractor", "supplier", "vendor", "other"] },
        trade: { type: "string" },
        invoice_number: { type: "string" },
        invoice_date: { type: "string", description: "YYYY-MM-DD" },
        due_date: { type: "string", description: "YYYY-MM-DD" },
        amount: { type: "number" },
        description: { type: "string" },
        estimate_line_item_id: { type: "string", description: "Budget line this invoice is for" },
        subcontractor_id: { type: "string", description: "Sub UUID" },
        gmail_message_id: { type: "string" },
        attachment_storage_path: { type: "string" },
        extracted_text: { type: "string" },
      },
      required: ["project_id", "vendor_name", "amount"],
    },
  },
  {
    name: "record_payment",
    description:
      "Record a payment received from a client — deposit, draw, progress payment, or final payment.",
    input_schema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "Project UUID" },
        payment_type: {
          type: "string",
          enum: ["deposit", "draw", "progress", "final", "change_order", "retainage", "other"],
        },
        amount: { type: "number" },
        received_date: { type: "string", description: "YYYY-MM-DD (default: today)" },
        method: { type: "string", enum: ["check", "wire", "ach", "credit_card", "cash", "zelle", "other"] },
        reference_number: { type: "string", description: "Check number, transaction ID" },
        description: { type: "string" },
        notes: { type: "string" },
      },
      required: ["project_id", "payment_type", "amount"],
    },
  },
  {
    name: "create_change_order",
    description: "Create a change order for scope/cost changes during construction.",
    input_schema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "Project UUID" },
        title: { type: "string", description: "Brief title of the change" },
        description: { type: "string", description: "Detailed description" },
        cost_impact: { type: "number", description: "What it costs US (internal)" },
        price_impact: { type: "number", description: "What we charge the CLIENT" },
        status: { type: "string", enum: ["draft", "submitted", "approved"], description: "Default: draft" },
      },
      required: ["project_id", "title"],
    },
  },

  // ── EMAIL ──────────────────────────────────
  {
    name: "draft_email",
    description:
      "Draft an email for review. ALWAYS use this before send_email. Follow the Penney Construction email style. User will see the draft and approve before sending.",
    input_schema: {
      type: "object" as const,
      properties: {
        to: { type: "string", description: "Recipient email address" },
        subject: { type: "string" },
        body: { type: "string", description: "Email body in plain text (converted to HTML with signature)" },
        reply_to_message_id: { type: "string", description: "Gmail message ID to reply to (for threading)" },
        project_name: { type: "string", description: "Associated project for logging" },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "send_email",
    description: "Send an email via Gmail. ONLY after user has explicitly approved the draft.",
    input_schema: {
      type: "object" as const,
      properties: {
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
        reply_to_message_id: { type: "string", description: "Gmail message ID for threading" },
        project_name: { type: "string" },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "link_email_to_project",
    description: "Link an email to a project so it appears in the project's email tab.",
    input_schema: {
      type: "object" as const,
      properties: {
        email_id: { type: "string", description: "Email UUID" },
        project_id: { type: "string", description: "Project UUID" },
      },
      required: ["email_id", "project_id"],
    },
  },

  // ── SCHEDULE ──────────────────────────────────
  {
    name: "create_schedule_event",
    description: "Create a calendar event (meeting, walkthrough, inspection) on Google Calendar.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD" },
        start_time: { type: "string", description: "HH:MM (24h)" },
        end_time: { type: "string", description: "HH:MM (24h)" },
        location: { type: "string" },
        description: { type: "string" },
        attendees: {
          type: "array",
          items: { type: "string" },
          description: "Attendee email addresses",
        },
        project_id: { type: "string", description: "Link to a project" },
      },
      required: ["title", "date", "start_time"],
    },
  },
  {
    name: "create_schedule_phase",
    description: "Add a construction phase to a project schedule (e.g. 'Demo', 'Framing', 'Electrical Rough').",
    input_schema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string" },
        name: { type: "string", description: "Phase name" },
        start_date: { type: "string", description: "YYYY-MM-DD" },
        end_date: { type: "string", description: "YYYY-MM-DD" },
        status: {
          type: "string",
          enum: ["not_started", "in_progress", "completed", "on_hold"],
          description: "Default: not_started",
        },
        notes: { type: "string" },
        event_type: {
          type: "string",
          enum: ["phase", "meeting", "walkthrough", "inspection"],
          description: "Default: phase",
        },
      },
      required: ["project_id", "name"],
    },
  },
  {
    name: "update_schedule_phase",
    description: "Update a schedule phase — change dates, status, or notes.",
    input_schema: {
      type: "object" as const,
      properties: {
        phase_id: { type: "string", description: "Phase UUID" },
        start_date: { type: "string" },
        end_date: { type: "string" },
        status: { type: "string", enum: ["not_started", "in_progress", "completed", "on_hold"] },
        notes: { type: "string" },
      },
      required: ["phase_id"],
    },
  },
];

// ── Combined list ──────────────────────────────────────────

export const ALL_TOOLS: Tool[] = [...READ_TOOLS, ...WRITE_TOOLS];

// ── Tool classification helpers ────────────────────────────

const READ_TOOL_NAMES = new Set(READ_TOOLS.map((t) => t.name));

export function isReadTool(name: string): boolean {
  return READ_TOOL_NAMES.has(name);
}

export function isWriteTool(name: string): boolean {
  return !READ_TOOL_NAMES.has(name);
}
