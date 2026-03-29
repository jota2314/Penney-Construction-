# Penney Construction — Command Center App

## What This Is
A construction management app for **Penney Construction, Inc.** — a residential general contractor on the North Shore of Massachusetts. Deployed at **penney-construction-mf6m.vercel.app**. Repo: `jota2314/Penney-Construction-`.

## Team
- **Ryan Penney** — Owner (rpenney@penneyconstructioninc.com)
- **Jorge Betancur** — Precon/Estimator, primary user building this app (jbetancur@penneyconstructioninc.com)
- **Nicole Smith** — Admin, handles permits + deposits (nsmith@penneyconstructioninc.com)
- **Howie Clickstein** — Field
- **Shannon Penney** — Intake

## Tech Stack
- **Next.js 16** (App Router, server components + client components, TypeScript, src/)
- **Supabase** — Postgres DB with RLS, auth, storage (project ID: `kozgjatzmllhvqwqbzzy`)
- **Claude Opus 4.6** — AI engine via Anthropic SDK (streaming chat, email analysis)
- **Gmail OAuth** — Two-way email: fetch inbox + send emails (scopes: drive, calendar, gmail, sheets, docs)
- **Google Drive** — Shared Drive "Penney Construction Folders" (ID: `0AE-3Z0cmiD5rUk9PVA`)
- **shadcn/ui** — Component library
- **Tailwind CSS** — Dark mode, amber/orange accent (#D97706)
- **Recharts** — Charts
- **Vercel** — Auto-deploys from `main` branch

## The Vision
The Command Center IS the entire app. Jorge opens it, everything he needs is right there. The AI does the heavy lifting: reads email, creates projects, tracks quotes, flags what needs attention. User just clicks, reviews, and goes.

## Architecture Overview

### Command Center (Home Screen)
9-tile navigation hub at `/command-center`. Each tile shows a metric + mini chart. Click → drill into full page.

**Tiles:** Projects, Estimates, Follow-ups, Quotes, Schedule, Clients, Subcontractors, Email, Cost Book

**Key files:**
- `src/app/(app)/command-center/page.tsx` — Server component with FetchEmailsButton
- `src/components/command-center/navigation-tile-grid.tsx` — 3x3 responsive grid
- `src/lib/actions/command-center-hub.ts` — `getHubMetrics()` (all 9 data sources)

### Email System (NEW — Active Development)
Interactive email-by-email triage. Emails stored in Supabase, user clicks one, chats with AI about it.

**Flow:**
1. "Fetch Emails" button → `POST /api/fetch-and-store-emails` → stores 20 emails in `inbox_emails` table with full body + attachments in Supabase storage
2. Click Email tile → `/command-center/emails` → shows stored email list (`EmailInbox` component)
3. Click an email → `/command-center/email/[id]` → split view: email content (left) + AI chat (right)
4. User tells AI: "This is a new project" / "Quote for Gouthro" / "Skip"
5. AI suggests actions → user says "save" → creates project/customer/quote in DB
6. Email marked as `is_processed`

**Key files:**
- `src/app/api/fetch-and-store-emails/route.ts` — Fetches from Gmail, downloads attachments, stores in Supabase
- `src/app/api/analyze-single-email/route.ts` — Analyzes ONE email with AI, accepts `userInstruction`
- `src/app/(app)/command-center/emails/page.tsx` — Email inbox page
- `src/app/(app)/command-center/email/[id]/page.tsx` — Email detail + AI chat
- `src/components/command-center/email-inbox.tsx` — Email list component
- `src/components/command-center/email-detail.tsx` — Split view: email + AI chat
- `src/components/command-center/fetch-emails-button.tsx` — Small fetch button for header

**Database:**
- `inbox_emails` table — gmail_message_id, subject, from/to, body, snippet, direction, attachments (JSONB), is_processed, project_id
- `email-attachments` storage bucket — files at `{messageId}/{filename}`, 50MB limit, all file types

### Projects Page
Card-based layout showing ALL projects (no CRM/construction mode split).

**Key files:**
- `src/app/(app)/projects/page.tsx` — Fetches all projects with customer data
- `src/components/projects/projects-view.tsx` — Card grid + table toggle, status filter tabs, search

**Features:** Card/table toggle, status filters (All/Active/Contracted/Estimating/Proposal/Lead), search by name/client/city

### AI Chat Panel
Slide-out chat panel (floating button) with streaming Claude responses, voice + text input.

**Key files:**
- `src/components/command-center/ai-chat-panel.tsx` — Main chat slide-out
- `src/app/api/chat/route.ts` — Streaming SSE endpoint
- `src/lib/ai/claude.ts` — `getAnthropicClient()`, `callClaude()` with model fallback

### Google Integrations
- **Drive:** Creates project folders in Shared Drive with subfolders (Lead Info, Walkthrough, Estimates, Proposals, Contracts, Job Package)
- **Gmail:** Sends HTML emails with company signature, template variable replacement
- **Calendar:** Creates walkthrough events
- **Auth tokens:** Stored in httpOnly cookies during OAuth callback (`google-access-token`, `google-refresh-token`)

**Key files:**
- `src/lib/google/drive.ts` — `createProjectFolder()`, `createGoogleDoc()`, Shared Drive ID hardcoded
- `src/lib/google/gmail.ts` — `sendEmail()` with HTML + signature, `sendTemplateEmail()`, attachment support
- `src/lib/google/calendar.ts` — `createWalkthroughEvent()`
- `src/lib/google/auth.ts` — Reads tokens from cookies
- `src/app/(auth)/auth/callback/route.ts` — Stores provider tokens in cookies

### Workflow Automation (13-stage pipeline)
Full project lifecycle tracking — separate from Command Center, accessible at `/workflow`.

**Stages:** Lead Intake → Schedule Confirmation → Walkthrough → Estimating → Owner Review → Client Review → Permit & Deposit → Job Package → PM Handoff → Construction → Rough Inspection → Final Inspection → Audit

**Key files:**
- `src/app/(app)/workflow/page.tsx` — Workflow list
- `src/app/(app)/workflow/[id]/page.tsx` — Workflow detail with delete button
- `src/components/workflow/workflow-actions-panel.tsx` — Stage-specific action buttons
- `src/lib/actions/workflow.ts` — All workflow server actions
- `src/lib/constants/workflow.ts` — 13 stages with labels, colors, descriptions

## Database Tables (Supabase)

### Core
- `profiles` — User accounts (3 users: Jorge x2, Ryan)
- `projects` — project_number (auto PC-YYYY-NNN via trigger), name, customer_id, status, project_type, phase, address, estimated_value, contract_value, scope_of_work, required_trades (JSONB)
- `customers` — first_name, last_name, email, phone, address
- `subcontractors` — company_name, contact_name, email, phone, trades (text[]), vetting_status, is_active

### Command Center Operations
- `inbox_emails` — Full Gmail storage: gmail_message_id, subject, from/to, body, attachments (JSONB with storage_path), is_processed, project_id
- `quote_requests` — Sub quotes: project_id, subcontractor_name, trade, amount, status, scope_description
- `follow_ups` — Action items: contact_name, description, priority, status (open/done/snoozed)
- `email_logs` — Email audit trail: direction, category, project_id

### Workflow
- `workflow_instances` — 13-stage lifecycle tracking with Google integration refs
- `workflow_actions` — Stage transition log
- `workflow_email_templates` — Email templates per stage (11 seeded)

### Storage Buckets
- `project-files` — 10MB, images only
- `email-attachments` — 50MB, all file types

### Other tables
- `estimates`, `estimate_line_items` — Estimation system
- `trade_rates` — 38 seeded NE US residential rates
- `leads`, `meetings`, `walkthroughs`, `site_visits` — Legacy CRM pipeline (not used by Command Center)
- `schedule_phases` — Project scheduling
- `conversations`, `conversation_messages` — AI chat persistence
- `app_settings` — API keys

## Design Principles
- **User drives, AI suggests** — Never auto-create data without user approval
- **One email at a time** — No batch scanning. User picks email, talks to AI, approves
- **Minimal token usage** — Only call AI when user explicitly asks
- **Think like a GC** — Understand trades, sub quotes, client proposals, project lifecycle
- **Dark mode first** — Amber/orange accent
- **Mobile responsive** — Works on phone in the field

## Current Status (March 28, 2026)

### Working
- 9-tile Command Center with live metrics
- Email fetch + store in Supabase (20 emails with attachments)
- Email inbox page with list view
- Email detail page with AI chat (split view)
- Projects page with card/table toggle and filters
- AI Chat panel with streaming + voice
- Workflow automation (13 stages)
- Google Drive folder creation in Shared Drive
- HTML emails with signature
- Sidebar navigation with grouped sections

### In Progress
- **Email triage AI chat** — user clicks email, chats with AI, AI creates projects/quotes/subs. Basic flow works, needs refinement
- **Attachment handling** — files stored in Supabase storage, need preview/download in email detail

### What Needs Work
- Email detail AI chat needs to be smarter about context and follow-up questions
- Attachment preview (PDF viewer, image thumbnails) in email detail
- Project detail page needs depth (emails, quotes, subs, scope, budget, schedule)
- Email compose flow through AI chat
- The AI should remember previous messages in the chat (conversation context)
- Supabase project ID: `kozgjatzmllhvqwqbzzy`

## Important Implementation Notes
- **Project numbers** auto-generate via DB trigger: `PC-YYYY-NNN`
- **Google OAuth tokens** stored in cookies, not Supabase session (provider_token doesn't persist)
- **Supabase join ambiguity**: estimates↔leads has 2 FKs, use `!estimates_lead_id_fkey` hint
- **AI engine**: `src/lib/actions/ai-email-engine.ts` has `saveApprovedDraft()` for saving actions without email reference
- **The old batch scan system** (sync-button.tsx, email-triage-wizard.tsx, analyze-emails route) still exists but is being replaced by the email-by-email approach
- **Database was wiped clean** on March 28 — all projects/customers/subs/quotes cleared for fresh start with new email triage system
