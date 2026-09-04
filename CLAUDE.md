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
- **Never type a component prop as `React.ElementType`** — use a concrete type such as `LucideIcon`. `@react-three/fiber` (added for the /design 3D studio) globally augments `React.JSX.IntrinsicElements` with the three.js elements, so `React.ElementType` now includes `<mesh>`, `<boxGeometry>`, etc. Those have no `className`, so TS intersects the union's props down to `never` and you get the baffling `Type 'string' is not assignable to type 'never'` on a perfectly normal `className`. This is R3F's documented behaviour, not a bug in our code, and it applies app-wide even though the 3D viewer is lazy-loaded on one route — types are global regardless of bundling.
- **Two different "invoice" concepts — do NOT conflate**:
  - `invoices` table = **vendor/subcontractor bills Penney OWES** (money OUT). `vendor_type` defaults to `subcontractor`. The Finances tab sums ALL rows here as "Spent". Never put a client invoice in this table or you corrupt the financials.
  - `client_invoices` table (migration `00089`) = **invoices the CLIENT owes Penney** (money IN). Mirrors the `change_orders` pipeline: create (`createClientInvoice` in `src/lib/actions/invoices.ts`) → branded PDF (`/api/generate-client-invoice`) → one-click send to client + auto-CC Ryan (`/api/send-client-invoice`, supports `testOnly`). `line_items` is JSONB `[{description, amount}]` so one invoice can itemize contracted scope + extras. UI lives in the project Finances tab ("Client Invoices" section, `project-finances-tab.tsx`). Sending blocks if the customer has no email on file — same as change orders, so attach a real customer record to the project first.

## Session History

### September 4, 2026 — Nicole's receipts dying at the edge + a third of her inbox hidden
- **"Missing receipt won't upload":** the spend organizer's receipt upload
  sent the RAW file to `/api/bills/scan`. Full-size iPhone photos (4–6 MB)
  exceed Vercel's 4.5 MB request cap, the platform drops them before the
  route runs (no runtime log, no storage object), and the client parsed the
  HTML 413 as "check the connection". Fix: `src/lib/image/bill-upload.ts` —
  every scan caller (BillDrop, AddBillDialog, spend organizer) now goes
  through `buildScanForm()`: photos downscaled to JPEG, anything still over
  4 MB uploaded straight to `field-captures` from the browser and passed as
  `storagePath` (+ `filename`); `readJsonResponse()` turns 413/401/504 into
  readable messages. Scan + commit routes accept the auth-user-id prefix on
  storage paths (differs from profile id while impersonating).
- **Manual fallback on a failed read:** BillDrop gets an "Enter it by hand
  instead" button (vendor + total typed, receipt/bill toggle, same job and
  budget-line pickers; `getJobBudgetLines` loads lines without a re-scan);
  AddBillDialog drops straight into its manual form; the spend organizer
  hands over to the row's own fields. In all three the file the person
  picked is still uploaded to storage (`uploadBillToStorage`) and attached,
  so a bill the AI can't read never has to be re-shot or emailed around.
- **Retry guard (hard stop):** `/api/bills/commit` returns 409 when the same
  person files the same vendor + amount within 15 minutes AND it is the same
  document (matching invoice number, or neither has one and same job).
  Vendor + amount alone is NOT a duplicate: porta-potty vendors bill the same
  rate per site monthly — Rest Stop #32257/#32254 and Potty Time I760/I764
  were filed minutes apart on 9/3 and are all real. The 45-day soft flag now
  also skips pairs with two different invoice numbers (it had flagged the
  September Rest Stop bill against August's).
- **A dropped tap no longer takes down the page.** Every server action in
  `spend-organizer.tsx` was awaited bare inside `startTransition`, so a failed
  POST (weak signal, timeout, deployment swapped under an open tab) rejected
  into the nearest error boundary — one tap on one row became a full-screen
  "Something went wrong · Load failed" (9/4 09:58 UTC; the Confirm had in fact
  saved). All five now go through `runRowAction()`, which reports inline and
  says the write MAY have landed — never "nothing changed", which is how a
  bill gets filed twice. `(app)/error.tsx` recognizes the browser's network
  wording and says so instead of echoing "Load failed".
- **Compare a flagged repeat side by side:** `invoices.duplicate_of_id`
  (migration `00137`, applied live) is set by `/api/bills/commit` when it
  flags a suspected duplicate; `listCapturesForReview` resolves older
  text-only flags with the same rule. `/spent/review` rows get a "Compare
  both" toggle → `DuplicateCompare` (this one vs. the one already in the
  books: receipt thumbnails that open full size, amount, invoice #, date,
  job, line, who filed it) with a verdict line (two invoice numbers = two
  bills) and "keep both" / "discard this one". Confirming clears the link.
- **Inbox hid mail stored under a teammate:** rfc822 dedup (00082) keeps one
  row per message owned by whichever Gmail synced first, and every inbox
  view filtered on `created_by`. Migration `00136_inbox_mailbox_ids`
  (applied live): `inbox_emails.mailbox_ids uuid[]` = every profile whose
  Gmail holds the message, `inbox_email_add_mailbox()` RPC stamped by the
  sync on a dedup hit, backfill from From/To. All inbox reads go through
  `mailboxFilter()` in `src/lib/email/mailbox-scope.ts`; `direction` is
  re-derived per viewer. Nicole: 2,463 → 3,277 visible rows.
- Noticed, not fixed: `/api/cron/fetch-emails` on the mf6m Vercel project
  401s every tick (CRON_SECRET mismatch); mail still syncs via the other
  Vercel project on the same repo.

### August 22, 2026 — Material suppliers stopped counting as subs
- **The bug:** Weekly Close listed Building Center of Essex under "Payments to
  subs", and the QuickBooks push booked those bills to Subcontractors Expense.
  It is a lumberyard. Root cause is `invoices.vendor_type`, which every writer
  defaults to `'subcontractor'` (createInvoice, the AI tool handler, the email
  engine, the inbox router, split-quote, bills/commit), so the SAME yard lands
  on both sides of the books — Building Center of Essex had 38 bills typed
  subcontractor and 80 typed supplier; across the table 205 bills / $119k were
  mis-typed (Home Depot, Moynihan, Jackson Lumber, Next Day Moulding, ABC
  Supply, Aubuchon, Floor & Decor, Building Center of Gloucester).
- **Fix — the vendor NAME outranks `vendor_type`.** `MATERIAL_SUPPLIER_VENDORS`
  + `isMaterialSupplier()` in `src/lib/finance/spend-category.ts` (the same
  shape as the existing in-house-labor override): a dealer name skips the
  "typed as a sub → Subcontractors Expense" branch and falls to Construction
  Materials Costs. Service keywords still win first, so a dumpster or permit
  billed through a supply house stays Disposal/Permits. Verified against every
  distinct matching vendor name in prod — 32 names, all genuine dealers, no
  installer caught (Master Floors, MGL Tile, Melrose Glass, WRD Painting all
  stay Subs).
- **Fix — new rows get typed right at write time.** `resolveVendorType(name,
  given)` in the same module; every writer that used to fall back to a bare
  "subcontractor" now goes through it. An explicit non-subcontractor choice
  still wins. `sub-portal/upload` is untouched — those really are subs.
- Migration `00128_material_supplier_vendor_type.sql` backfills the 205 stored
  rows and keeps each prior value in `vendor_type_backfill_00128` so the
  backfill is exactly reversible. NOT YET APPLIED to prod — display and the QBO
  account choice are already correct without it, since categorization no longer
  trusts the field.

### August 19, 2026 — Spent page: real totals, chart of accounts, project names
- **Fixed silently-wrong totals:** `/spent` fetched `.limit(500)` but 2026 has
  ~1,445 invoices, so the Year view showed $566k when the real figure (page's
  own `paid_amount || amount` formula) is **~$1.52M**. Now paginates in
  1000-row pages (id tiebreak so same-date rows can't straddle pages).
- **New shared module `src/lib/finance/spend-category.ts`** — the QBO
  account rules (`accountNameFor`, OVERHEAD/JOB rule tables, SERVICE_KEYWORDS)
  moved here out of `quickbooks/expenses.ts`, which now imports them (push
  behavior byte-identical). Adds `spendCategoryFor()` for display: same rules,
  plus (a) every text field votes (trade+description joined — a generic trade
  like "general" can't hide "building permit fee" in the description) and
  (b) in-house labor detection FIRST — vendors "In-House Labor" / "Penney
  Construction (Labor)" appear with every vendor_type including
  `subcontractor`, so vendor name outranks type; sub labor stays Subs.
  2026 distribution sanity-checked against prod: Subs $829k / Labor $294k /
  Materials $293k / Disposal $58k / Permits $28k.
- **Spent page rebuilt** (still 100% server-rendered, no client JS): spend-by-
  month/week/day bar chart (year→months, month→weeks, week→days; bars link to
  the drilled-in period; current bucket highlighted), "Where it went"
  chart-of-accounts breakdown (rows link to `?cat=` which filters ONLY the
  transaction list — tiles/charts stay whole), and the list is grouped under
  sticky month/week/day headers with per-group subtotal + open amount. Every
  row now shows the project NAME + number (was number-only), short date,
  Inv #, and a colored category chip. Year/quarter cap each month group at 25
  rendered rows with a "+ N more — open the month" link (header still counts
  everything) so the 1,400-row year doesn't crawl on a phone.
- `/spent/[id]` detail shows the category chip + "Books to {QBO account} in
  QuickBooks".
- Returns/credits (negative amounts) are clamped in bar/track widths; labels
  keep the signed number.
- Jorge's request: take Howie's pay off the crew screens — nobody should see
  it. New tier ABOVE the office-rate protection: `HIDDEN_PAY_EMAILS` in
  `src/lib/auth/role-access.ts` (currently hclick@). `getRateVisibility()`
  resolves those emails to `hiddenEmployeeIds`/`hiddenProfileIds` (matched on
  BOTH `profiles.email` and `employees.email`, cross-linked both ways) and
  `canSeeRate()` returns false for them BEFORE the viewAll and self checks —
  so owners, precon, payroll viewers, and Howie himself all get the masked
  view. Every surface already using `canSeeRate`/`maskTimeEntryRates` inherits
  it: payroll timesheet, crew-admin roster + shifts, /employees, /team (+
  member dashboard earnings), project Finances labor rows, phase financials,
  live map, command-center feed, AI chat roster/context/tools.
- Payroll keeps his HOURS (rows stay editable); rate shows "No rate set",
  cost 0, and the displayed grand total is rebuilt from visible rows so his
  pay can't be backed out by subtraction. `missingRateWorkers` now counts
  true missing rates only (pre-mask), so the amber "set a rate" banner
  doesn't permanently nag about masked rows.
- Writes guarded so masked edit forms can't wipe the real rate:
  `updateEmployee` already dropped unseeable rates; `updateTeamMember` now
  has the same guard. Consequence: his $62/hr is read-only in the app for
  everyone — change it directly in the DB if his pay ever changes.
- Self surfaces covered too: `getCrewEmployee`/`getCrewEarnings` return no
  rate/earnings for hidden people (crew profile Work Info + EarningsCard),
  which also covers Jorge's View-as impersonation.
- Deliberately unchanged: blended labor AGGREGATES (project/phase spent,
  feed's today-burn ticker, CEO sums) still include his cost so job costing
  stays true — only per-person pay is hidden. Caveat: `employees.hourly_rate`
  is still readable via the raw PostgREST API by any signed-in user (same
  app-layer posture as the office-rate protection; see the RLS note above) —
  lock the column with Postgres column privileges if that ever matters.

### July 24, 2026 — Contract e-signing + a contract price that stops moving
- **The bug this closes:** nothing ever created payment milestones (the four
  onClick handlers in `payment-schedule-card.tsx` were the only writers), and
  `/api/generate-contract` PRINTED a hard-coded thirds split when a project had
  none — without saving it. So clients held contracts with a payment schedule
  the app had no record of, and none of those payments could be one-click
  invoiced. Caraglia (PC-2026-118) is the case in point: contract sent 6/17,
  client paid exactly $53,585.25 ÷ 3 = $17,861.67, tile still said "No payment
  schedule yet."
- **Second bug:** `projects.contract_value` is rewritten by the estimate-sync
  trigger on every send/accept, and the contract PDF re-summed the visible
  estimate lines live at render time. Verified against prod (in a rolled-back
  transaction): re-sending Caraglia's estimate moved contract_value
  53,585.25 → 999,999. Nothing was frozen at signing.
- **Contract e-sign flow** (migration `00107`, applied live): 17 `contract_*`
  columns on `projects` — token (unique index, which `change_orders` never
  got), send/view tracking, client signature, and a Penney **countersignature**
  the CO flow never had. Public `/contract/[token]` page + `/api/sign-contract`
  (service-role, outside `(app)` so middleware lets it through), and
  `/api/send-contract` cloned from `send-change-order`. Sending seeds the
  thirds schedule first, so the PDF can no longer print a schedule that isn't
  in the DB.
- **The lock:** `sync_project_value_from_estimate()` now skips `contract_value`
  when `contract_locked_at is not null`. `estimated_value` still tracks the
  estimate — that's the pipeline number, not the contracted price.
- **On countersignature** (`lockContractAndPremakeInvoices` in
  `src/lib/contracts/contract-lock.ts`): freeze the price → convert every
  percent milestone to fixed dollars (cents absorbed into the last row) →
  **premake one draft `client_invoice` per milestone** → reconcile payments
  already received on an exact dollar match only. Milestone status `scheduled`
  (constraint widened) distinguishes "invoice drafted" from "invoice sent".
- **QuickBooks moved to send time.** `createClientInvoice` takes
  `skip_quickbooks`; premade drafts don't hit QBO until
  `/api/send-client-invoice` actually sends them. Otherwise signing one
  contract would post three unbilled invoices.
- **`markContractSignedOnPaper`** covers the jobs signed before this existed
  (Caraglia, Sobol, Gouthro, Ledgewood) — same lock, same premade invoices, no
  email round trip. Without it those tiles stay empty forever.
- Client signature notifies owners/precon/office (in-app + push + email).
  Change-order approvals still notify nobody — worth fixing the same way.

### July 19, 2026 — @tags of unlinked employees notified nobody (fixed)
- **Root cause of "even when I tag, no notification/email":** the @mention
  picker (`listActivityMentions`) takes `profileId` from
  `employees.profile_id`, and the employee rows for Ryan, Howie, Paul
  Gouthro, and Bill Crowley were never linked to their profiles — tagging
  them stored a tag with `profileId: null`, so no notification was even
  attempted. Backfilled `employees.profile_id` by email match (live data
  fix), and the picker now falls back to matching the employee's email
  against `profiles` so future unlinked rows still resolve.
- Verified the email leg itself works in production (mention emails from
  July 10–13 are in the team's mailboxes; Gmail sync + outbound sends
  healthy). NOTE: the `app_settings` `google_client_id/secret` fallback
  pair is STALE — refresh-token exchange with it returns 401
  unauthorized_client. Prod works because Vercel env `GOOGLE_CLIENT_ID/
  SECRET` is set and correct; don't rely on the DB fallback until those
  rows are updated.
- Push notifications only reach the 4 profiles with a registered device
  (Jorge-work, Ryan, Angel, John). Everyone else needs to enable
  notifications in the app on their phone — in-app bell + email work
  regardless.

### July 19, 2026 — Feed posts notify the whole team
- New feed posts (command-center company posts AND the crew "Post update"
  daily logs) now send in-app + push + email notifications to EVERY profile,
  not only @tagged people — a post with no tags previously notified no one.
  `notifyTeamOfFeedPost` in `src/lib/notifications/tagged-mentions.ts` shares
  the mention delivery pipeline (`deliverNotifications`): tagged recipients
  keep the "tagged you" variant (kind=`mention`), everyone else gets
  "{author} posted an update" (kind=`post` — migration `00105` widens the
  `app_notifications` kind check, applied live). Author excluded; the unique
  (recipient, source_type, source_id) key keeps it to one notification per
  person per post. Notify failures are caught so posting never breaks.
  Feed comments and project updates are unchanged (author/mentions only);
  clock-outs never notify.

### July 18, 2026 — Payment schedule milestones + in-app contract PDFs
- **Payment Schedule block** now lives INSIDE the "Client Invoices" section of
  the project Finances tab (one combined flow): per-project milestones with
  stage keys (deposit, footings, framing, rough_inspection, final_inspection,
  weathertight, …), one-click presets ("Thirds", "Deposit / rough / final",
  "5 milestones inspection-based"), % or fixed-$ per row, and an MA c.142A
  warning when the deposit exceeds 1/3. Table `project_payment_milestones`
  (migration `00104`, applied live). Files: `payment-schedule-card.tsx`,
  `src/lib/actions/payment-schedule.ts`, `src/lib/constants/payment-schedule.ts`.
- **One-click invoicing:** every milestone row has a "Create invoice" button →
  `invoiceMilestone()` resolves the amount (fixed $ or % of contract →
  estimate fallback), reuses `createClientInvoice` (per-project numbering +
  QuickBooks mirror), stores `client_invoice_id` on the milestone, and the row
  then shows the live linked-invoice status (Invoice #N / paid).
- **`/api/generate-contract?projectId=…`** renders a branded CONSTRUCTION
  CONTRACT PDF in the same jsPDF house style + dual auth (signed-in user or
  `proposal_pdf_service_key` header) as generate-proposal-pdf. Contents:
  parties block (HIC Reg #198443 + CSL CS-099765), price in words, payment
  schedule table fed by `project_payment_milestones` (defaults to thirds when
  none set), 11 contract terms (3-business-day right to cancel, c.142A
  deposit + arbitration clauses), Exhibit A scope grouped from the estimate
  line items, exclusions incl. estimate "Scope:" notes, signature block.
  Opened via the "Contract PDF" button on the Payment Schedule block.

### July 15, 2026 — One-tap clock out
- Clocking out no longer asks for a note + photos. The `ClockOutSheet`
  (required text + ≥1 photo) is deleted; the Clock Out buttons in
  `hours-strip.tsx` and `todays-work-card.tsx` call `clockOutWithLog(logId)`
  directly (note/photo params are now optional). Crew still shares photos +
  notes via the separate "Post update" flow on /crew — that flow is unchanged.
- Bare clock-outs (no note, no photos, status completed) are filtered out of
  the social feeds in `listRecentDailyLogs` so they don't render as empty
  posts. Hours/time-log/payroll are unaffected — those query by
  status/timestamps, not content.

### July 11, 2026 — QuickBooks OAuth fixed + two-way sync (sandbox)
- **Root cause of the long-standing "invalid_client" connect failure:** two
  independent problems. (1) `src/lib/quickbooks/auth.ts` read credentials and
  stored tokens via the cookie-scoped Supabase client; the OAuth callback from
  Intuit can arrive without a session, so RLS silently returned zero rows →
  empty Basic auth → `invalid_client`, and token writes were silently dropped
  (tokens were empty since April despite "connected" UI). Fixed: the module now
  uses the service-role admin client and fails loudly. (2) Jorge's Intuit login
  has no access to the real Penney Construction QBO company, so Intuit minted
  authorization codes for the developer **sandbox** context while the app
  exchanged them with **production** keys — also `invalid_client`.
- **Current state: connected to the SANDBOX company** ("Advanced Sandbox
  Company US b96a", realm `9341457444509960`) using the Intuit app's
  Development keys. `app_settings.quickbooks_environment = 'sandbox'` switches
  the API base (`src/lib/quickbooks/client.ts`); production keys are backed up
  in `quickbooks_production_client_id/secret`. To go live: get admin access to
  the real QBO company, restore prod keys, set environment=production,
  reconnect while signed in as that account.
- **Projects → QuickBooks** (`src/lib/quickbooks/customers.ts`): `createProject`
  now mirrors new projects best-effort — client becomes a QBO Customer, project
  becomes a sub-customer/Job (`PC-#### name`), Ids stored on
  `customers.quickbooks_customer_id` / `projects.quickbooks_customer_id`
  (migration `00101`). `syncProjectToQuickBooks` backfills.
- **Client invoices → QuickBooks** (`src/lib/quickbooks/invoices.ts`):
  `createClientInvoice` mirrors the invoice onto the project's Job (line items
  → SalesItemLine against a find-or-created "Construction Services" service
  Item); QBO Id + DocNumber stored on `client_invoices` (migration `00102`).
- **Caution:** "Sync Now" (QB → app) pulls the sandbox's fake vendors/bills
  into real tables (`invoices` feeds the Spent totals). Don't run it while in
  sandbox mode, or clean up rows with `quickbooks_id LIKE 'qb\_%'` after.

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

### September 2, 2026 — Cosentino awarded everywhere + sub portal v2
- **Data fix (live, no migration):** Cosentino Plumbing and Heating (sub id
  `3bd10465-…`) had 9 plumbing quotes sitting at `received` on jobs he was
  already working (Pedersen, Ouellette, Breen, Gallegos, Parziale, Arnott,
  Frechette, O'Mealia, Ritchie). All flipped to `accepted` (same semantics as
  `awardQuote` in `sub-awarding.ts`), and `project_subcontractors.contract_amount`
  was set to the sum of his accepted+approved quotes per job — four rows had
  been sitting at $0. Rival quotes on those jobs were all HVAC (DL Services),
  a different trade, so nothing was declined. Ritchie (PC-2026-167) was then
  put BACK to `received` — Jorge: not awarded yet, still being figured out.
- **Cosentino billing reconciled to QuickBooks (live).** Source of truth is
  the `quickbooks@notification.intuit.com` mail to Nicole: "Invoice NNNN from
  COSENTINO" when he bills, "Payment confirmation: Invoice #NNNN" when she
  pays. Findings: (a) inbox_router + office_entry had BOTH filed the same
  invoice — Arnott 1995/1996 and Danti 1997 were double-counted; aggregate
  rows deleted, line-split rows kept. (b) Weidlein carried a $7,500
  Approve-as-Bill placeholder on top of the three real invoices ($8,150) —
  deleted. (c) Invoice 1988 O'Mealia $7,940 (paid 8/7) was never entered —
  added. (d) Invoice 2001 Caraglia $1,435 (9/2, hose bibs) — added, unpaid.
  (e) Six rows were `paid` with paid_amount 0 (Weidlein, Cleary) — filled,
  QBO invoice numbers stamped. Pattern to watch: any sub invoice that shows
  up twice with the same number is the router + office double-entry.
- **Sub portal rebuilt** (`/sub/portal`). The 1,100-line page is now
  `src/components/sub-portal/*` (types, ui kit, five tabs, `portal-app.tsx`)
  and the page mounts it client-only via `next/dynamic` (portal cookie +
  localStorage tab restore make SSR pointless). Bottom tab bar: **Home**
  (greeting, one-tap clock in on today's job, Awarded/Owed tiles, next date,
  awarded-jobs list), **Schedule** (this week / next week / later), **Jobs**
  (awarded price is the headline, quotes carry plain-language pills:
  Awarded / Under review / Not selected / Price needed), **Money** (owed vs
  paid, per-job progress bars, open/all invoice filter), **Field** (clock,
  post with photo previews, invoice/quote upload, feed). Refreshes on
  visibility change. `/api/sub-portal` now returns `document_type` and
  `received_at` on quotes. `src/app/sub/layout.tsx` adds metadata + noindex.
