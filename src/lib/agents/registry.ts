/**
 * The Agent Crew: the scheduled Claude Code Routines that work the job
 * site while Jorge sleeps. Each one is a "construction worker" on the
 * Agent Crew dashboard. The Routines themselves live in Claude Code on
 * the web; this registry just describes them for the UI and gives each
 * a stable agent_key that the Routine writes to agent_runs.
 */

export type AgentKey =
  | "dispatcher"
  | "invoice_logger"
  | "quote_finder"
  | "ledger_sync"
  | "follow_up_sweeper"
  | "deposit_watcher";

export interface AgentDef {
  key: AgentKey;
  name: string;
  /** The worker's job-site role. */
  role: string;
  emoji: string;
  /** Tailwind accent (hard-hat / vest color). */
  color: string;
  schedule: string;
  description: string;
  /** What it produces for the review queue. */
  produces: string;
  /** True once a real scheduled routine is wired up. False = "Coming soon" card (no metrics). */
  live: boolean;
}

export const AGENTS: AgentDef[] = [
  {
    key: "dispatcher",
    name: "Dispatch Dan",
    role: "Inbox Dispatcher",
    emoji: "📬",
    color: "sky",
    schedule: "Hourly · 7a–6p",
    description:
      "Reads each new inbound email and routes it like an office manager — files drawings to the right project, drafts replies for anything needing an answer, and hands bills to the Bookkeeper. Never sends.",
    produces: "Filed docs + draft replies",
    live: true,
  },
  {
    key: "invoice_logger",
    name: "Bookkeeper Bill",
    role: "Invoice Bookkeeper",
    emoji: "🧮",
    color: "emerald",
    schedule: "Hourly · 7a–6p",
    description:
      "Catches vendor bills in the inbox, reads the amount and trade off the PDF, matches them to the right job, and posts them to the live P&L. Anything it isn't sure about lands in your review queue.",
    produces: "Logged bills (P&L updated)",
    live: true,
  },
  {
    key: "quote_finder",
    name: "Quincy",
    role: "Quote Finder",
    emoji: "🧾",
    color: "amber",
    schedule: "Daily · 7:00 AM",
    description:
      "Scans new inbox emails for subcontractor quotes, extracts the dollar amount from the PDF, and matches it to the right project.",
    produces: "Draft quotes to review",
    live: false,
  },
  {
    key: "ledger_sync",
    name: "Ledger Lou",
    role: "Bookkeeper",
    emoji: "💰",
    color: "emerald",
    schedule: "Nightly · 11:00 PM",
    description:
      "Re-reads every job's Drive ledger sheet so deposits, expenses, and cash balance stay current across all projects.",
    produces: "Updated job financials",
    live: false,
  },
  {
    key: "follow_up_sweeper",
    name: "Frank",
    role: "Follow-up Foreman",
    emoji: "📌",
    color: "sky",
    schedule: "Daily · 8:00 AM",
    description:
      "Flags quotes and proposals that have gone quiet — no reply after several days — so nothing slips through.",
    produces: "Follow-up reminders",
    live: false,
  },
  {
    key: "deposit_watcher",
    name: "Dottie",
    role: "Deposit Watcher",
    emoji: "🏦",
    color: "violet",
    schedule: "Daily · 6:00 PM",
    description:
      "Watches the Drive receipts folders for new deposit checks and logs them to the job ledger.",
    produces: "New deposits logged",
    live: false,
  },
];

export function getAgent(key: string): AgentDef | undefined {
  return AGENTS.find((a) => a.key === key);
}
