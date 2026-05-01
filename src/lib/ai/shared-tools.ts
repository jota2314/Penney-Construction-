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
          enum: ["lead", "estimating", "waiting_for_approval", "proposal_sent", "contracted", "in_progress", "completed", "cancelled"],
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
    name: "get_budget_lines",
    description:
      "Get all estimate line items (budget lines) for a project — shows description, trade, budgeted cost, and current spend. Use this to find the right budget line ID when splitting or assigning invoices.",
    input_schema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "Project UUID" },
      },
      required: ["project_id"],
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
  {
    name: "search_costbook",
    description:
      "Search Penney's cost book (trade_rates table). Returns unit prices and costs for materials, labor, and flat-rate trade items. Search by keyword to find matching rates. This is the company's internal pricing data used for estimating.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description:
            "Search keyword — matches against trade_name. E.g., 'foundation', '2x10', 'kitchen electrical', 'LVL', 'roofing', 'siding', 'window', etc.",
        },
        category: {
          type: "string",
          description: "Optional: filter by category like 'framing', 'electrical', 'plumbing', 'materials', 'painting'",
        },
      },
    },
  },
  {
    name: "list_project_documents",
    description:
      "List ALL available documents for a project — proposals, change order PDFs, financial reports, stored quote/invoice PDFs, email attachments, and uploaded project files. Use this to find the right document to attach to an email. Returns both generatable documents (with URLs) and stored files (with storage paths).",
    input_schema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "Project UUID" },
        query: { type: "string", description: "Optional search term to filter results (e.g. 'proposal', 'plumbing quote', 'invoice')" },
      },
      required: ["project_id"],
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
          enum: ["lead", "estimating", "waiting_for_approval", "proposal_sent", "contracted", "in_progress", "completed", "cancelled"],
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
    description: "Create a quote request record for tracking sub quotes on a project. ALWAYS include estimate_line_item_id — every quote must hang off an estimate line. Use list_line_items_for_bidding first to find the right line.",
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
        estimate_line_item_id: { type: "string", description: "REQUIRED when project_id known — line item this quote prices" },
      },
      required: ["project_name", "subcontractor_name", "trade"],
    },
  },
  {
    name: "list_line_items_for_bidding",
    description:
      "List estimate line items for a project — shows description, trade, estimated cost, awarded sub (if any), and bids out (sub name + amount + status). The line item is the spine — every bid/quote/invoice hangs off it. Call BEFORE send_bid_to_subs, record_quote_received, or create_quote_request to get the right line_item_id.",
    input_schema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "Project UUID" },
        trade: { type: "string", description: "Optional — filter to one trade" },
      },
      required: ["project_id"],
    },
  },
  {
    name: "send_bid_to_subs",
    description:
      "Send an RFQ for a specific estimate line item to one or more subs. Creates a bid_packages row + subcontractor_bids rows tied to the line item, then sends RFQ emails (with project drawings auto-attached). ALWAYS confirm with the user (which line, which subs) before calling.",
    input_schema: {
      type: "object" as const,
      properties: {
        estimate_line_item_id: { type: "string", description: "Line item UUID — get from list_line_items_for_bidding" },
        subcontractor_ids: { type: "array", items: { type: "string" }, description: "UUIDs of subs to send to" },
        scope_of_work: { type: "string", description: "Optional override; defaults to line description" },
        due_date: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["estimate_line_item_id", "subcontractor_ids"],
    },
  },
  {
    name: "record_quote_received",
    description:
      "Record that a sub returned a quote amount for an outstanding bid. Updates the subcontractor_bids row to status='submitted' with the amount. Use when user says 'Smith quoted $9,200' or you parsed an inbound email PDF.",
    input_schema: {
      type: "object" as const,
      properties: {
        bid_id: { type: "string", description: "subcontractor_bids UUID" },
        amount: { type: "number" },
        gmail_message_id: { type: "string", description: "Inbound email ID for audit" },
      },
      required: ["bid_id", "amount"],
    },
  },
  {
    name: "award_bid",
    description:
      "Award a bid. Marks bid.is_selected=true, others on the same line as rejected, AND writes awarded_bid_id/awarded_subcontractor_id/awarded_cost back to estimate_line_items (the spine). Always confirm with user first.",
    input_schema: {
      type: "object" as const,
      properties: {
        bid_id: { type: "string", description: "subcontractor_bids UUID to award" },
      },
      required: ["bid_id"],
    },
  },
  {
    name: "create_invoice",
    description:
      "Record a vendor/sub invoice against a project. IMPORTANT: You MUST call search_projects first to get the real project_id. Use get_budget_lines to get estimate_line_item_id. NEVER make up UUIDs.",
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
    name: "split_invoice",
    description:
      "Split an existing invoice across multiple budget lines. Works on paid, unpaid, or partial invoices. IMPORTANT: You MUST call list_invoices first to get real invoice IDs, and get_budget_lines to get real line_item_ids. NEVER make up UUIDs.",
    input_schema: {
      type: "object" as const,
      properties: {
        invoice_id: { type: "string", description: "The invoice UUID to split" },
        splits: {
          type: "array",
          description: "Array of splits — amounts must sum to the original invoice total",
          items: {
            type: "object",
            properties: {
              line_item_id: { type: "string", description: "Budget line UUID (from get_budget_lines)" },
              amount: { type: "number", description: "Dollar amount for this budget line" },
              note: { type: "string", description: "Brief description of what this covers" },
            },
            required: ["line_item_id", "amount"],
          },
        },
      },
      required: ["invoice_id", "splits"],
    },
  },
  {
    name: "update_invoice",
    description:
      "Update an existing invoice — change its trade, budget line, payment status, or description. IMPORTANT: You MUST call list_invoices first to get the real invoice_id. NEVER make up UUIDs.",
    input_schema: {
      type: "object" as const,
      properties: {
        invoice_id: { type: "string", description: "The invoice UUID to update" },
        trade: { type: "string", description: "New trade category" },
        estimate_line_item_id: { type: "string", description: "New budget line UUID" },
        payment_status: { type: "string", enum: ["unpaid", "partial", "paid"] },
        description: { type: "string" },
        amount: { type: "number", description: "New amount (only if correcting)" },
      },
      required: ["invoice_id"],
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
    description: "Create a change order for scope/cost changes during construction. MUST call search_projects first to get real project_id. NEVER make up UUIDs.",
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

  {
    name: "update_change_order",
    description:
      "Update an existing change order — change status (approve, reject, void), title, description, or financial impact. MUST call list_change_orders first to get real change_order_id. NEVER make up UUIDs.",
    input_schema: {
      type: "object" as const,
      properties: {
        change_order_id: { type: "string", description: "The change order UUID" },
        title: { type: "string" },
        description: { type: "string" },
        status: { type: "string", enum: ["draft", "submitted", "approved", "rejected", "void"] },
        cost_impact: { type: "number" },
        price_impact: { type: "number" },
        approved_by: { type: "string", description: "Client name who approved" },
      },
      required: ["change_order_id"],
    },
  },

  // ── EMAIL ──────────────────────────────────
  {
    name: "draft_email",
    description:
      "Draft an email for review. ALWAYS use this before send_email. Follow the Penney Construction email style. User will see the draft and approve before sending. To attach documents, call list_project_documents first to find the right file, then include the attachment info here.",
    input_schema: {
      type: "object" as const,
      properties: {
        to: { type: "string", description: "Recipient email address" },
        cc: { type: "string", description: "Optional CC recipients — comma-separated if multiple. If Jorge says 'cc Ryan' or 'include Ryan', put rpenney@penneyconstructioninc.com here." },
        bcc: { type: "string", description: "Optional BCC — comma-separated" },
        subject: { type: "string" },
        body: { type: "string", description: "Email body in plain text (converted to HTML with signature)" },
        reply_to_message_id: { type: "string", description: "Gmail message ID to reply to (for threading)" },
        project_name: { type: "string", description: "Associated project for logging" },
        attachments: {
          type: "array",
          description: "Documents to attach. Use url for generated docs (proposals, COs, reports) or storage_path for stored files (quotes, invoices, email attachments).",
          items: {
            type: "object",
            properties: {
              url: { type: "string", description: "Relative API URL for generated documents (e.g. /api/generate-proposal-pdf?projectId=xxx)" },
              storage_path: { type: "string", description: "Supabase storage path for stored files (from list_project_documents)" },
              drive_file_id: { type: "string", description: "Google Drive file ID (from list_project_documents)" },
              filename: { type: "string", description: "Display filename for the attachment" },
            },
            required: ["filename"],
          },
        },
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
        cc: { type: "string", description: "Optional CC — comma-separated" },
        bcc: { type: "string", description: "Optional BCC — comma-separated" },
        subject: { type: "string" },
        body: { type: "string" },
        reply_to_message_id: { type: "string", description: "Gmail message ID for threading" },
        project_name: { type: "string" },
        attachments: {
          type: "array",
          description: "Documents to attach (passed through from draft_email).",
          items: {
            type: "object",
            properties: {
              url: { type: "string" },
              storage_path: { type: "string" },
              filename: { type: "string" },
            },
            required: ["filename"],
          },
        },
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

  // ── ESTIMATE + DOCUMENT GENERATION ──────────────────────────
  {
    name: "generate_estimate",
    description:
      "Generate a full estimate for a project using Penney's trade rates, price book, existing sub quotes, takeoff measurements, and project scope. Creates the estimate and all line items in the database. Use when the user says 'generate an estimate', 'price this out', 'create an estimate', etc.",
    input_schema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "Project UUID" },
        instructions: {
          type: "string",
          description: "Optional extra instructions from the user (e.g. 'use 35% markup on framing', 'exclude landscaping')",
        },
      },
      required: ["project_id"],
    },
  },
  {
    name: "generate_bid_package",
    description:
      "Generate a bid package PDF for a subcontractor — includes project info, trade scope, measurements, and drawing screenshots. Use when Jorge wants to send scope to a sub for pricing. The sub receives a professional PDF with everything they need to bid.",
    input_schema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "Project UUID" },
        trade: { type: "string", description: "Trade name (e.g. 'Excavation', 'Foundation', 'Framing')" },
        scope_text: { type: "string", description: "Detailed scope of work for this trade — what the sub needs to price" },
        measurements: { type: "string", description: "Key measurements and quantities (e.g. '60 LF perimeter, 415 SF footprint, 8ft depth')" },
        screenshot_paths: {
          type: "array",
          items: { type: "string" },
          description: "Storage paths of screenshots to include (from takeoff chat session)",
        },
        sub_name: { type: "string", description: "Subcontractor name (for the PDF header)" },
        notes: { type: "string", description: "Additional notes for the sub" },
      },
      required: ["project_id", "trade", "scope_text"],
    },
  },
  {
    name: "generate_proposal",
    description:
      "Generate a client proposal spreadsheet (Excel) for a project. Requires an estimate with line items. Returns a download link.",
    input_schema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "Project UUID" },
      },
      required: ["project_id"],
    },
  },
  {
    name: "generate_change_order_pdf",
    description:
      "Generate a formal change order PDF with pricing breakdown, contract summary, and signature blocks. The change order must already exist in the database.",
    input_schema: {
      type: "object" as const,
      properties: {
        change_order_id: { type: "string", description: "Change order UUID" },
      },
      required: ["change_order_id"],
    },
  },
  {
    name: "generate_financial_report",
    description:
      "Generate a financial report PDF for a project — shows contract value, change orders, invoiced costs, payments, profit margin, and budget vs actual by line item.",
    input_schema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "Project UUID" },
      },
      required: ["project_id"],
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
    description: "Add a construction phase to a project schedule (e.g. 'Demo', 'Framing', 'Electrical Rough'). start_date is required. For single-day phases (e.g. 'Hardwood Finish Coat — Wed morning'), omit end_date and it will default to start_date.",
    input_schema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string" },
        name: { type: "string", description: "Phase name" },
        start_date: { type: "string", description: "YYYY-MM-DD. Required." },
        end_date: { type: "string", description: "YYYY-MM-DD. Optional — defaults to start_date for single-day phases. Must be >= start_date." },
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
      required: ["project_id", "name", "start_date"],
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
  {
    name: "save_file_to_project",
    description:
      "Save a file (from chat attachment) to a project's document storage. Use when the user uploads a PDF, drawing, invoice, quote, or any file in chat and asks to save/store it in a project. The file must have been uploaded in this chat — use the storage_path from the attachment context.",
    input_schema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "Project UUID" },
        storage_path: { type: "string", description: "Supabase storage path from the chat attachment context" },
        filename: { type: "string", description: "Display filename (e.g. 'Construction Drawings.pdf')" },
        category: {
          type: "string",
          enum: ["construction_drawings", "specs", "pricing", "permits", "contracts", "photos", "invoices", "quotes", "other"],
          description: "File category. Default: other",
        },
        description: { type: "string", description: "Optional description of the file" },
      },
      required: ["project_id", "storage_path", "filename"],
    },
  },
];

// ── ESTIMATING tools (used by takeoff chat) ───────────────

export const ESTIMATING_TOOLS: Tool[] = [
  {
    name: "update_estimate_line_item",
    description:
      "Update an existing estimate line item — change scope text, quantity, unit, price, or trade. Use when the user describes scope for a trade that already has a line item in the estimate.",
    input_schema: {
      type: "object" as const,
      properties: {
        line_item_id: { type: "string", description: "The estimate line item UUID" },
        scope_text: { type: "string", description: "Detailed scope description — what's included. Use bullet points with dashes." },
        quantity: { type: "number", description: "Updated quantity" },
        unit: { type: "string", description: "Unit (SF, LF, EA, LS, CY, SY, etc.)" },
        unit_cost: { type: "number", description: "Cost per unit" },
        total_cost: { type: "number", description: "Total cost (quantity × unit_cost)" },
        total_price: { type: "number", description: "Total client price (cost × 1.30 default markup)" },
        description: { type: "string", description: "Line item title/category name" },
        notes: { type: "string", description: "Internal notes" },
      },
      required: ["line_item_id"],
    },
  },
  {
    name: "add_estimate_line_item",
    description:
      "Add a new line item to the project's estimate. Use when the user describes scope for a trade that doesn't have a line item yet.",
    input_schema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "Project UUID" },
        description: { type: "string", description: "Line item title/category (e.g. 'Demolition', 'Framing', 'Plumbing Rough')" },
        scope_text: { type: "string", description: "Detailed scope — what's included. Use bullet points with dashes." },
        quantity: { type: "number", description: "Quantity (default 1)" },
        unit: { type: "string", description: "Unit (SF, LF, EA, LS, etc. — default LS)" },
        unit_cost: { type: "number", description: "Cost per unit" },
        total_cost: { type: "number", description: "Total cost" },
        total_price: { type: "number", description: "Client price (cost × 1.30 default markup)" },
        trade: { type: "string", description: "Trade key (e.g. 'demolition', 'framing', 'plumbing')" },
        notes: { type: "string", description: "Internal notes" },
      },
      required: ["project_id", "description"],
    },
  },
];

// ── Combined list ──────────────────────────────────────────

export const ALL_TOOLS: Tool[] = [...READ_TOOLS, ...WRITE_TOOLS, ...ESTIMATING_TOOLS];

// ── Takeoff chat tools (estimating-focused subset) ────────

export const TAKEOFF_CHAT_TOOLS: Tool[] = [
  // READ: what the estimator needs to look up
  ...READ_TOOLS.filter(t => ["get_budget_lines", "search_costbook", "get_project_details", "get_project_financials", "search_subcontractors", "list_project_documents"].includes(t.name)),
  // WRITE: estimate editing + bid package workflow
  ...ESTIMATING_TOOLS,
  // generate_bid_package is REQUIRED here — trade chat sends to subs, never proposals
  ...WRITE_TOOLS.filter(t => ["draft_email", "send_email", "generate_bid_package"].includes(t.name)),
];

// ── Field crew safe tool list ──────────────────────────────
// Field crew must NEVER see financial data. This allowlist drops every tool
// that could return wages, prices, costs, budgets, quotes, invoices, P&L,
// markup, or contract values. Schedule, drawings, basic project info, and
// personal todos only.

const FIELD_SAFE_TOOL_NAMES = new Set<string>([
  "search_projects",
  "get_project_details",
  "search_emails",
  "get_email_details",
  "get_schedule",
  "list_todos",
  "list_project_documents",
  "create_todo",
  "update_todo",
  "save_file_to_project",
]);

export const FIELD_TOOLS: Tool[] = [...READ_TOOLS, ...WRITE_TOOLS].filter((t) =>
  FIELD_SAFE_TOOL_NAMES.has(t.name)
);

// ── Tool classification helpers ────────────────────────────

const READ_TOOL_NAMES = new Set(READ_TOOLS.map((t) => t.name));

export function isReadTool(name: string): boolean {
  return READ_TOOL_NAMES.has(name);
}

export function isWriteTool(name: string): boolean {
  return !READ_TOOL_NAMES.has(name);
}
