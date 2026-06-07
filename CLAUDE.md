# Penney Construction — Command Center App

## What This Is
A construction management app for **Penney Construction, Inc.** — a residential general contractor on the North Shore of Massachusetts. Deployed at **penney-construction-mf6m.vercel.app**. Repo: `jota2314/Penney-Construction-`.

## Claude Memory Protocol (read this first)
Claude Code runs in throwaway containers, so it has a **persistent memory in Supabase**
(project `kozgjatzmllhvqwqbzzy`) to carry context across sessions. A SessionStart hook
(`.claude/hooks/session-start.sh`) reminds Claude to load it on turn one.

- **Tables:** `claude_memory` (durable facts/preferences/decisions/todos) and
  `claude_journal` (a dated log of what each session worked on). Single-user (Jorge).
- **On session start:** read both via the Supabase MCP `execute_sql` to understand
  what Jorge has been doing (estimates, app features, admin) and what's still open.
- **When Jorge says "save" / "remember", or when meaningful work wraps up:** write back.
  - Journal a session: `insert into claude_journal (area, summary, details) values ('app','…','…');`
    (`area` ∈ `estimate | app | admin | mcp | other`)
  - Upsert a durable fact:
    `insert into claude_memory (category, title, body, tags, priority) values (…)
     on conflict (lower(title)) where status='active' do update set body = excluded.body, updated_at = now();`
    (`category` ∈ `preference | project_context | workflow | decision | contact | gotcha | todo | note`)
- **Keep it tight:** prefer updating an existing memory over piling on near-duplicates;
  archive stale items (`status='archived'`) instead of deleting. This memory is *separate*
  from the in-app AI chat (`conversations`/`conversation_messages`) and the agent crew log
  (`agent_runs`).

## Team
- **Ryan Penney** — Owner (rpenney@penneyconstructioninc.com)
- **Jorge Betancur** — Precon/Estimator, primary user building this app (jbetancur@penneyconstructioninc.com)
- **Nicole Smith** — Admin, handles permits + deposits (nsmith@penneyconstructioninc.com)
- **Howie Clickstein** — Field
- **Shannon Penney** — Intake

## Tech Stack
- **Next.js 16** (App Router, server components + client components, TypeScript, src/)
- **Supabase** — Postgres DB with RLS, auth, storage (project ID: `kozgjatzmllhvqwqbzzy`)
- **Claude Opus 4.6** — AI engine via Anthropic SDK (streaming chat, email analysis, PDF text extraction)
- **Gmail OAuth** — Two-way email: fetch inbox + send emails (scopes: drive, calendar, gmail, sheets, docs)
- **Google Drive** — Shared Drive "Penney Construction Folders" (ID: `0AE-3Z0cmiD5rUk9PVA`)
- **shadcn/ui** — Component library
- **Tailwind CSS** — Dark mode, amber/orange accent (#D97706)
- **Recharts** — Charts
- **pdfjs-dist** — Client-side PDF rendering (dynamically imported in pdf-viewer.tsx)
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

### Email System
Interactive email-by-email triage. Emails stored in Supabase, user clicks one, chats with AI about it.

**Flow:**
1. "Fetch Emails" button → `POST /api/fetch-and-store-emails` → stores 20 emails in `inbox_emails` table with full body + attachments in Supabase storage
2. Click Email tile → `/command-center/emails` → shows stored email list (`EmailInbox` component)
3. Click an email → `/command-center/email/[id]` → split view: email content (left) + AI chat (right)
4. User tells AI: "This is a new project" / "Quote for Gouthro" / "Skip"
5. AI suggests actions → user says "save" → creates project/customer/quote in DB
6. Email marked as `is_processed`

**PDF Text Extraction in Email Chat:**
- `email-chat` route downloads PDF/image attachments from Supabase storage
- Converts to base64, sends to Claude via native document understanding (`type: "document"`)
- Extraction prompt: "Extract ALL text from this document. Include every number, name, address, date, line item, total."
- Extracted text cached in `inbox_emails.attachments[i].text_content` (up to 50k chars)
- Truncated to 8k chars when included in AI prompts
- AI is instructed to ALWAYS extract dollar amounts from PDFs, never say "amount in attached PDF"

**Key files:**
- `src/app/api/fetch-and-store-emails/route.ts` — Fetches from Gmail, downloads attachments, stores in Supabase
- `src/app/api/email-chat/route.ts` — AI chat endpoint with PDF extraction, proposed actions
- `src/app/api/analyze-single-email/route.ts` — Initial triage (match/new project/skip)
- `src/app/(app)/command-center/emails/page.tsx` — Email inbox page
- `src/app/(app)/command-center/email/[id]/page.tsx` — Email detail + AI chat (accepts `returnUrl` query param)
- `src/components/command-center/email-inbox.tsx` — Email list component
- `src/components/command-center/email-detail.tsx` — Split view: email + AI chat
- `src/components/command-center/fetch-emails-button.tsx` — Small fetch button for header

**Database:**
- `inbox_emails` table — gmail_message_id, subject, from/to, body, snippet, direction, attachments (JSONB with storage_path + text_content), is_processed, project_id
- `email-attachments` storage bucket — files at `{messageId}/{filename}`, 50MB limit, all file types

### Project Detail Page
Tabbed layout with Command Center-style overview + sub-tabs.

**Tabs:** Overview, Emails, Quotes, Files, AI Chat

**Overview tab** has 6 NavigationTile tiles (Emails, Quotes, Files, Estimates, Budget, Meetings) that either switch to a sub-tab (onClick) or navigate to a page (href).

**Quotes tab:**
- Expandable quote detail cards — tap to expand, shows full info (amount, trade, scope, extracted PDF text, notes)
- "View PDF" button opens the signed PDF URL in a new browser tab (native zoom/scroll)
- Falls back to finding PDFs from project's linked emails when `attachment_storage_path` is null
- Groups quotes by document type (quote, invoice, change order, etc.)

**Files tab:**
- Categorizes files by document type using filename heuristics + quote cross-referencing
- Categories: Quotes, Invoices, Change Orders, Estimates, Permits, Contracts, Photos, Other

**Key files:**
- `src/app/(app)/projects/[id]/page.tsx` — Server component, fetches all project data
- `src/components/projects/project-detail.tsx` — Overview with NavigationTile grid
- `src/components/projects/project-detail-tabs.tsx` — Tabbed layout (controlled tabs with useState)
- `src/components/command-center/navigation-tile.tsx` — Reusable tile, supports `onClick` (button) or `href` (link)

**Navigation patterns:**
- Tabs use controlled state (`activeTab` + `setActiveTab`) for programmatic switching
- "Back to Overview" button on each sub-tab
- `returnUrl` query param for contextual back navigation from email detail pages

### PDF Viewer
Client-side PDF rendering using pdfjs-dist. Renders pages as images with zoom controls.

**IMPORTANT — iOS Browser Limitations:**
- iOS forces ALL browsers (Chrome, Firefox, Edge) to use WebKit (Safari's engine)
- Browser pinch-to-zoom happens at the OS level, BEFORE any JavaScript runs
- `user-scalable=no` has been ignored by iOS since iOS 10 (2016)
- `touch-action`, `preventDefault()`, `GestureEvent` — none can reliably intercept pinch on iOS
- **Solution for PDFs:** Open signed URL directly in new browser tab for native PDF viewer with perfect zoom
- In-app PDF viewer (`PdfPages` component) has floating +/- zoom buttons for when native zoom isn't available

**Key files:**
- `src/components/ui/pdf-viewer.tsx` — `PdfPages` (renders pages) + `PdfViewer` (full-screen overlay)

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
- `inbox_emails` — Full Gmail storage: gmail_message_id, subject, from/to, body, attachments (JSONB with storage_path + text_content), is_processed, project_id
- `quote_requests` — Sub quotes: project_id, subcontractor_name, trade, amount, status, scope_description, gmail_message_id, attachment_storage_path, document_type, extracted_text
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

## Current Status (March 29, 2026)

### Working
- 9-tile Command Center with live metrics
- Email fetch + store in Supabase (20 emails with attachments)
- Email inbox page with list view
- Email detail page with AI chat (split view) with PDF text extraction
- Projects page with card/table toggle and filters
- Project detail page with tabbed layout (Overview, Emails, Quotes, Files, AI Chat)
- Expandable quote detail cards with amount, scope, extracted text, and View PDF button
- PDF viewer with zoom controls (opens in new tab on mobile for native zoom)
- AI Chat panel with streaming + voice
- Workflow automation (13 stages)
- Google Drive folder creation in Shared Drive
- HTML emails with signature
- Sidebar navigation with grouped sections
- Document organization by category (quotes, invoices, change orders, etc.)
- Quote-to-PDF linkage (direct + email attachment fallback)
- Contextual back navigation with returnUrl pattern

### In Progress
- **Email triage AI chat** — Basic flow works. AI extracts PDF text, suggests actions, user approves. Needs refinement on multi-step conversations.
- **PDF text extraction → quote amounts** — AI prompt updated to always extract dollars from PDFs. New quotes should have extracted_text field populated.

### What Needs Work
- Run migration `00032_quote_attachment_fields.sql` and `00033_quote_extracted_text.sql` on production Supabase
- Email compose flow through AI chat
- The AI should remember previous messages in the chat (conversation context)
- Project detail page needs more depth (budget tracking, schedule timeline)
- Supabase project ID: `kozgjatzmllhvqwqbzzy`

## Important Implementation Notes
- **Project numbers** auto-generate via DB trigger: `PC-YYYY-NNN`
- **Google OAuth tokens** stored in cookies, not Supabase session (provider_token doesn't persist)
- **Supabase join ambiguity**: estimates↔leads has 2 FKs, use `!estimates_lead_id_fkey` hint
- **AI engine**: `src/lib/actions/ai-email-engine.ts` has `saveApprovedDraft(actions, emailId?, emailDate?)` — MUST pass emailId from email-detail so quotes get proper gmail_message_id
- **Quote dedup**: Only blocks duplicate quotes from the same email (gmail_message_id), NOT from the same subcontractor. Multiple quotes from same sub are allowed.
- **PDF on iOS**: Browser-level pinch zoom cannot be intercepted on iOS (WebKit controls it at OS level). PDFs opened in new tab for native viewer. In-app viewer uses +/- buttons as fallback.
- **The old batch scan system** (sync-button.tsx, email-triage-wizard.tsx, analyze-emails route) still exists but is being replaced by the email-by-email approach
- **Database was wiped clean** on March 28 — all projects/customers/subs/quotes cleared for fresh start with new email triage system

## Session History (March 29, 2026)

### Changes Made This Session
1. **Quote attachment linking** — Added `attachment_storage_path` and `document_type` columns to quote_requests. AI engine saves these when creating quotes from emails.
2. **Project detail overview tiles** — Replaced old QuickAction buttons with Command Center-style NavigationTile grid (Emails, Quotes, Files, Estimates, Budget, Meetings).
3. **Controlled tabs with back navigation** — Project detail tabs converted to controlled state. "Back to Overview" button on each sub-tab. Tab labels always visible on mobile.
4. **returnUrl pattern** — Emails opened from a project pass returnUrl so back button returns to the project, not global inbox.
5. **PDF viewer iterations** — Went through 8+ iterations trying to get pinch-to-zoom working on iOS Chrome. Final solution: open PDFs in new browser tab for native zoom. In-app viewer has +/- zoom buttons.
6. **Expandable quote detail cards** — Tap quote to expand and see full details (amount, trade, scope, extracted PDF text). "View PDF" button opens in new tab.
7. **Quote-to-PDF fallback** — When `attachment_storage_path` is null, searches project's linked emails for matching PDF attachments by subcontractor name.
8. **Fixed saveApprovedDraft** — Was using dummy email with empty id. Now passes actual `gmail_message_id` and `email.date` so quotes are properly linked.
9. **Fixed dedup logic** — Was blocking all quotes from same sub+project. Now only blocks same sub+project+email.
10. **PDF text extraction in AI prompt** — Updated create_quote action to include `extracted_text`. AI instructed to always extract dollar amounts, never say "amount in attached PDF".
