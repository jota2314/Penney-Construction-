# Penney Construction — Command Center App

## What This Is
A construction management app for **Penney Construction, Inc.** — a residential general contractor on the North Shore of Massachusetts. Deployed at **penney-construction.vercel.app**. Repo: `jota2314/Penney-Construction-`.

## Team
- **Ryan Penney** — Owner
- **Jorge Betancur** — Precon/Estimator (primary user building this app)
- **Nicole Smith** — Admin
- **Howie Clickstein** — Field
- **Shannon Penney** — Intake

## Tech Stack
- **Next.js 16** (App Router, server components + client components)
- **Supabase** — Postgres DB with RLS, auth, storage
- **Claude Opus 4.6** — AI engine via Anthropic SDK (streaming chat, email analysis)
- **Gmail OAuth** — Two-way email: fetch inbox + send emails
- **shadcn/ui** — Component library (Card, Badge, Button, Sheet, Tabs, etc.)
- **Tailwind CSS** — OKLCH color system, dark mode, amber/orange accent (#D97706)
- **Recharts** — Charts (BarChart, PieChart, ResponsiveContainer)
- **Vercel** — Deploys from `main` branch

## Architecture Overview

### Command Center (Home Screen)
The Command Center (`/command-center`) is a **9-tile navigation hub** — like an iPhone home screen. Each tile shows a key metric + mini chart. Click any tile → navigates to a dedicated full page.

**Tiles:** Projects, Estimates, Follow-ups, Quotes, Schedule, Clients, Subcontractors, Email, Cost Book

**Key files:**
- `src/app/(app)/command-center/page.tsx` — Server component, fetches hub metrics
- `src/components/command-center/command-center-hub.tsx` — Client wrapper (tiles + AI chat state)
- `src/components/command-center/navigation-tile-grid.tsx` — 3x3 responsive grid of tiles
- `src/components/command-center/navigation-tile.tsx` — Reusable tile component
- `src/components/command-center/mini-charts.tsx` — MiniBarSegments, MiniDonut, MiniSparkline, PriorityBadges
- `src/lib/actions/command-center-hub.ts` — `getHubMetrics()` server action (all 9 data sources)

### AI Chat Panel
Slide-out chat panel (bottom-right floating button) with streaming Claude Opus 4.6 responses, voice + text input, email compose through conversation.

**Key files:**
- `src/components/command-center/ai-chat-panel.tsx` — Main chat slide-out (Sheet)
- `src/components/command-center/chat-input.tsx` — Voice + text input
- `src/components/command-center/chat-message.tsx` — Message bubbles with streaming cursor
- `src/app/api/chat/route.ts` — Streaming SSE endpoint using `anthropic.messages.stream()`
- `src/lib/ai/chat-system-prompt.ts` — Context-aware system prompt builder
- `src/lib/ai/claude.ts` — `getAnthropicClient()`, `callClaude()` with model fallback
- `src/hooks/use-speech-recognition.ts` — Browser Speech API wrapper

### AI Email Engine (Deep Scan)
Scans Gmail, sends batches of emails to Claude for analysis. Claude creates projects, customers, quotes, follow-ups, and logs emails automatically.

**Key files:**
- `src/components/command-center/sync-button.tsx` — AI Sync Gmail + Deep Scan buttons with progress bar
- `src/app/api/analyze-emails/route.ts` — Sends email batches to Claude with system prompt for analysis
- `src/lib/actions/ai-email-engine.ts` — `clearAllData()`, `getNewEmailIds()`, `saveBatchResults()`, `executeAction()`
- `src/lib/google/gmail-sync.ts` — Gmail API: `fetchMessagesByIds()`, `fetchEmailIdList()`, `fetchRecentEmails()`
- `src/lib/google/gmail.ts` — `sendEmail()` with HTML signature, `sendTemplateEmail()`

**Deep Scan flow:**
1. `clearAllData()` — Clears ALL data (projects, customers, quotes, follow-ups, emails)
2. `getNewEmailIds(200)` — Fetches 200 email IDs from Gmail
3. Batches of 5 emails → `POST /api/analyze-emails` → Claude analyzes
4. Claude returns JSON with actions: `create_project`, `create_customer`, `create_quote`, `create_follow_up`, `update_project_stage`, `log_email`, `skip`
5. `saveBatchResults()` executes each action against Supabase
6. Actions are sorted: customers first, then projects, then quotes/follow-ups (so references work)

### Sidebar Navigation
Grouped sections: Home (Command Center), Core (Projects, Estimates, Quotes, Schedule), People (Customers, Subcontractors), Tools (Email, Follow-ups, Cost Book), Settings.

**Key files:**
- `src/lib/constants/nav-items.ts` — `NAV_GROUPS` with grouped nav items
- `src/components/layout/app-sidebar.tsx` — Sidebar with logo
- `src/components/layout/nav-main.tsx` — Nav item rendering with group labels

### Sub-Pages (drill-down from tiles)
- `src/app/(app)/command-center/follow-ups/page.tsx` — Full follow-ups list
- `src/app/(app)/command-center/quotes/page.tsx` — Quote pipeline with filters
- `src/app/(app)/command-center/emails/page.tsx` — Email volume chart
- `src/app/(app)/projects/` — Project list and detail pages
- `src/app/(app)/customers/` — Customer list
- `src/app/(app)/estimates/` — Estimates
- `src/app/(app)/subcontractors/` — Subcontractor list
- `src/app/(app)/schedule/` — Schedule (Gantt)
- `src/app/(app)/cost-book/` — Trade rates

## Database Tables (Supabase)
- `projects` — id, project_number (auto: PC-YYYY-###), name, customer_id, status, project_type, address, city, state, zip, description, estimated_value, contract_value, phase, etc.
- `customers` — id, first_name, last_name, email, phone, address, city, state, zip, notes
- `quote_requests` — id, project_id, subcontractor_name, project_name, trade, amount, status (just_sent/awaiting_reply/received/in_progress/accepted/declined), scope_description
- `follow_ups` — id, project_id, project_name, contact_name, contact_type, description, priority (low/medium/high/urgent), status (open/done/snoozed), due_date
- `email_logs` — id, gmail_message_id, subject, from_email, to_email, direction (inbound/outbound), category, project_id, sent_at
- `subcontractors` — id, company_name, contact_name, trades, is_active, etc.
- `estimates` — id, project_id, status, line items, totals
- `trade_rates` — id, trade, rate, unit, updated_at
- `schedule_phases` — id, project_id, phase_name, start_date, end_date, status
- `project_subcontractors` — project_id, subcontractor_id (junction table)
- `conversations`, `conversation_messages` — AI chat persistence (migration 00031)

## Known Subs
MTP Electric, Pedersen Electrical, DL Services (HVAC), Jackson Lumber (Chris Parello), Essex County Craftsmen (Brad Noyes), Timberline (Jon Holmes), Building Center of Gloucester (Steve Black), Wanderson Oliveira (Framing), Jonathan Tobar (Framing), Joe Mello (Siding), Marcio Silva (Tile), Peter Nguyen (Hardwood), Cosentino Plumbing, Topcrete (Foundation).

## Development Workflow
- Feature branch: `claude/plan-command-center-redesign-2hF4F`
- Always merge to `main` after commits (Vercel deploys from main)
- Use `npx tsc --noEmit` to type-check before committing
- Supabase queries should be wrapped in error handlers (some tables may not exist yet)

## Design Principles
- Command Center = visual navigation hub, NOT a data-heavy dashboard
- Click tile → go to full dedicated page (drill-down navigation)
- AI should be proactive: surface actions, organize data automatically
- Dark mode first, amber/orange accent color
- Mobile responsive (1-col mobile, 2-col tablet, 3-col desktop)
- All DB queries wrapped in safe() handlers for resilience

## Current Status / What's Working
- 9-tile Command Center home screen with metrics and mini charts
- AI Chat panel with streaming Claude Opus 4.6, voice input
- Deep Scan: AI analyzes Gmail and creates projects, customers, quotes, follow-ups automatically
- Full sidebar navigation with grouped sections
- Dedicated pages for follow-ups, quotes, emails
- Progress bar during sync operations

## What Needs Work
- Deep Scan quality: AI project creation from emails needs refinement — names, dedup, status detection
- Some DB tables may not have migrations run yet (estimates, schedule_phases, conversations)
- Document/attachment extraction from emails (PDFs, spreadsheets) into project records
- Project detail pages need more depth (scope, drawings, specs, budget)
- Email compose flow through AI chat (draft → approve → send)
