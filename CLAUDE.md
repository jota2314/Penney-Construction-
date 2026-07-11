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
- **Claude** — AI engine via Anthropic SDK (streaming chat, email analysis, PDF text extraction). NOTE: the codebase currently references ~6 different model IDs (sonnet-4, haiku-4-5, sonnet-4-6, opus-4-6, plus stale opus-4-0 and claude-3-5-sonnet). Worth consolidating to a single source of truth.
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

## App Map — what's actually here (June 2026)

> The app has grown FAR beyond the original 9-tile Command Center. As of this
> writing: **~83 API routes, ~60 pages, 100+ applied DB migrations.** The
> sections above describe the original core; the list below is the real surface
> area. Treat the live Supabase DB (`kozgjatzmllhvqwqbzzy`) as the source of
> truth for schema — the repo's `supabase/migrations/` folder has drifted and
> is missing many migrations that are live.

**Major subsystems (route groups under `src/app/(app)`):**
- **Command Center** — `/command-center` + `emails`, `email/[id]`, `quotes`,
  `todos`, `reviews`, `agents`, `inbox-v2`
- **Projects** — `/projects/[id]` with deep estimate flow: `estimates`,
  `estimates/drawings/takeoff`, `pricing`, `scope`, `quotes`, `budget`, `bids`
- **Estimating** — `/estimates`, takeoff measurements, price book / cost book
- **Financials** — `/spent`, `/payments`, `/overhead`, job ledger, invoices,
  change orders, QuickBooks integration (`/api/quickbooks/*`)
- **Bids & Proposals** — `/bids`, `/bid-requests`, `/proposals`
- **CEO dashboard** — `/ceo`
- **Crew / field app** — separate `(crew)` route group: clock in/out, time log,
  daily logs, punch lists, field reports; `crew-admin`
- **CRM (legacy)** — `/crm/leads`, `/crm/meetings`, `/walkthroughs`,
  `/site-visits`
- **Team & employees** — `/team`, `/employees`, role-aware profiles,
  impersonation
- **Warehouse** — `/warehouse` inventory catalog + stock ledger (Paul Gouthro's
  system); `/warehouse/orders` material-order queue; field crew orders from
  `/crew/materials`. Tables: `warehouse_items`, `warehouse_transactions`,
  `material_orders`, `material_order_items` (migration `00087`). All stock
  changes go through the `warehouse_adjust_stock()` SQL function (atomic
  update + ledger row, blocks negative stock). Order flow: pending → approved →
  ready → delivered (or rejected/cancelled); "Mark Picked" deducts stock.
  Order numbers `MO-YYYY-NNN`, SKUs `WH-NNNN`. Key files:
  `src/lib/actions/warehouse.ts`, `src/components/warehouse/*`,
  `src/components/crew/crew-materials.tsx`.
- **Workflow** — `/workflow` 13-stage pipeline (as documented above)
- **Agents** — autonomous email triage / dispatcher / invoice bookkeeper
  ("Agent Crew"), Gmail push (`/api/gmail/push`, `watch`) + cron triage
- **Push notifications** — web-push / VAPID

## Current Status (June 8, 2026)

### Known issues found in the latest investigation
- ✅ **FIXED — email sync duplicate-key flood.** `gmail-sync.ts` loaded *all*
  stored `gmail_message_id`s to dedup, but PostgREST caps `.select()` at 1000
  rows and the table has ~3,950 emails — so recent mail looked "new", got
  re-inserted, tripped the unique constraint on every sync, and starved the
  batch so genuinely new mail stopped ingesting. Now does a page-scoped `.in()`
  lookup + `upsert(..., { ignoreDuplicates: true })`.
- ✅ **FIXED — security exposure (migration `00083_security_rls_lockdown`).**
  `mcp_oauth_*` tables (incl. a readable refresh-`token` column) and
  `email_drafts` were reachable via the public API with RLS off; 9 reporting
  views were `SECURITY DEFINER`. RLS enabled + views flipped to
  `security_invoker`. All ERROR-level advisor findings cleared.
- ⚠️ **Model-ID sprawl** — ~6 different Claude model IDs across the code,
  including stale ones. Consolidate.
- ⚠️ **RLS posture** — ~100 policies are `USING (true)` (any signed-in user
  sees everything). Acceptable for a single-company internal tool, but there is
  no per-user/role data isolation. Revisit if outside users ever get accounts.
- ⚠️ **Migration drift** — repo `supabase/migrations/` ≠ live DB history.
- ℹ️ The two one-off `column "source"/"i.cost_code" does not exist` log errors
  were traced to manual SQL-editor queries, NOT app code.

### Build / lint health
- `tsc --noEmit` passes clean. Production build is green on Vercel (local builds
  here fail only because the sandbox can't fetch Google Fonts).
- Lint: 52 errors are React-19 hook-rule violations (quality, not crashes).
  `public/**` is now excluded from lint (was producing ~1,100 bogus warnings
  from the vendored pdf.js worker).
- See `.env.example` for the 19 required environment variables.

## Important Implementation Notes
- **Project numbers** auto-generate via DB trigger: `PC-YYYY-NNN`
- **Google OAuth tokens** stored in cookies, not Supabase session (provider_token doesn't persist)
- **Supabase join ambiguity**: estimates↔leads has 2 FKs, use `!estimates_lead_id_fkey` hint
- **AI engine**: `src/lib/actions/ai-email-engine.ts` has `saveApprovedDraft(actions, emailId?, emailDate?)` — MUST pass emailId from email-detail so quotes get proper gmail_message_id
- **Quote dedup**: Only blocks duplicate quotes from the same email (gmail_message_id), NOT from the same subcontractor. Multiple quotes from same sub are allowed.
- **PDF on iOS**: Browser-level pinch zoom cannot be intercepted on iOS (WebKit controls it at OS level). PDFs opened in new tab for native viewer. In-app viewer uses +/- buttons as fallback.
- **The old batch scan system** (sync-button.tsx, email-triage-wizard.tsx, analyze-emails route) still exists but is being replaced by the email-by-email approach
- **Email sync dedup**: `gmail-sync.ts` must check existing `gmail_message_id`s with a page-scoped `.in()` query, never a full-table `.select()` — PostgREST caps results at 1000 rows and the table has thousands (see the fixed bug above).
- **Two Supabase clients**: `@/lib/supabase/server` (anon key + user cookies → `authenticated` role, subject to RLS) vs `@/lib/supabase/admin` (service role → bypasses RLS). Pick deliberately; server-only/sensitive tables should be touched via `admin`.
- **Two different "invoice" concepts — do NOT conflate**:
  - `invoices` table = **vendor/subcontractor bills Penney OWES** (money OUT). `vendor_type` defaults to `subcontractor`. The Finances tab sums ALL rows here as "Spent". Never put a client invoice in this table or you corrupt the financials.
  - `client_invoices` table (migration `00089`) = **invoices the CLIENT owes Penney** (money IN). Mirrors the `change_orders` pipeline: create (`createClientInvoice` in `src/lib/actions/invoices.ts`) → branded PDF (`/api/generate-client-invoice`) → one-click send to client + auto-CC Ryan (`/api/send-client-invoice`, supports `testOnly`). `line_items` is JSONB `[{description, amount}]` so one invoice can itemize contracted scope + extras. UI lives in the project Finances tab ("Client Invoices" section, `project-finances-tab.tsx`). Sending blocks if the customer has no email on file — same as change orders, so attach a real customer record to the project first.

## Session History

### July 11, 2026 — Reliable @mention emails (cookie-independent Gmail send)
- Tag notification emails no longer depend on the *tagger's* Google OAuth
  cookies. `notifyTaggedProfiles` now resolves a Gmail access token
  server-side via `profiles.google_refresh_token` (actor's own account first,
  then any connected teammate as fallback) and sends through the new
  `sendEmailWithAccessToken()` in `src/lib/google/gmail.ts`. Previously,
  posts by users without Google connected (crew, PMs, impersonated sessions)
  silently dropped the email leg. Push/email failures are now logged instead
  of swallowed, and the email's app link falls back to the production URL when
  `APP_BASE_URL` is unset. Covers all four mention sources: project updates,
  company posts, daily logs, feed comments.

### July 11, 2026 — @mentions in feed comments
- Comments support `@` tagging (migration `00097`, applied live: adds
  `tagged_entities` + `mentioned_profile_ids` to `feed_comments`). The
  `CommentThread` input reuses `listActivityMentions()` (workers, subs, jobs)
  with the same match scoring as the post composer; tagged teammates get a
  mention notification (in-app + push + email via `notifyTaggedProfiles`,
  `MentionSource` extended with `feed_comment`). The post author still gets a
  comment notification unless they were tagged (no double ping). @Tokens render
  amber in comment bodies.

### July 10, 2026 — Feed comments + unified feed
1. **Comments on company posts and daily logs** — new `feed_comments` table
   (migration `00096`, applied live) keyed by `(source_type, source_id)` with
   RLS (read: all authenticated, insert/delete: own). Server actions in
   `src/lib/actions/feed-comments.ts`; `CommentThread` component
   (`src/components/field-feed/comment-thread.tsx`) rendered on both
   `CompanyPostCard` and `DailyLogPost`. Commenting notifies the post author
   (in-app `app_notifications` kind=`comment`, source_type=`feed_comment`
   keyed by comment id so every comment notifies, + web push).
2. **Unified feed** — command-center's "Company updates" and "From the field"
   sections merged into ONE "Company updates" section: company posts, daily
   logs, and punch groups interleaved newest-first.
3. Comments ride along on `CompanyFeedPost.comments` / `FeedDailyLog.comments`
   (one batched query inside `listRecentCompanyFeedPosts` /
   `listRecentDailyLogs`), so /crew and the project Production tab get them too.

### June 8, 2026 — App investigation + fixes
1. **Fixed the email sync duplicate-key flood** (`gmail-sync.ts`) — page-scoped dedup + idempotent upsert. This was the root cause of "email not updating."
2. **Security lockdown** (migration `00083_security_rls_lockdown.sql`) — enabled RLS on `mcp_oauth_*` + `email_drafts`, flipped 9 reporting views to `security_invoker`. Cleared all ERROR-level Supabase advisor findings.
3. **Lint hygiene** — excluded `public/**` (killed ~1,100 bogus warnings from the pdf.js worker).
4. **Added `.env.example`** documenting all 19 required env vars.
5. **Rewrote the stale status/app-map sections** of this doc to match the real (much larger) app.

### March 29, 2026 — (historical)
Quote attachment linking, project-detail overview tiles, controlled tabs with
back nav, returnUrl pattern, PDF viewer iterations (iOS pinch-zoom → open in new
tab), expandable quote cards, quote-to-PDF fallback, `saveApprovedDraft`
email-id fix, quote dedup fix, PDF text extraction in AI prompt.
