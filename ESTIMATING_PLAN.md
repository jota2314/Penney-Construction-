# Estimating System — Build Plan

## The Problem
Jorge needs to estimate jobs fast, chase subs for pricing, know his profit before sending a proposal, and then track that budget through construction. Right now: Excel spreadsheets, manual quote chasing, no visibility into profit until the job is done.

## The Flow (how a real GC estimates)

### Step 1: Scope the Job
- Walk the site, take notes/photos (walkthrough feature — exists)
- AI reads the notes and generates a scope of work
- Scope becomes the estimate skeleton: list of trades/phases needed

### Step 2: Build the Estimate
- Each line item = a trade or phase (Demo, Framing, Plumbing, Electric, etc.)
- Some lines Jorge prices himself (labor + materials he knows)
- Some lines need sub quotes (plumbing, electric, HVAC, tile, glass)
- Some lines use allowances (dumpster, permits — known rough costs)

### Step 3: Chase Sub Quotes
- For each line that needs a sub quote, the system:
  - Shows which subs do that trade (from sub database)
  - Lets Jorge send quote requests to multiple subs
  - Tracks who responded, who hasn't, follow-up reminders
  - When a quote comes in (via email), AI auto-matches it to the estimate line
- Status per line: ✅ Quoted | ⏳ Waiting | ❌ No Quote Yet

### Step 4: Price It (30% markup)
- Cost = sub quote + materials + labor hours
- Client price = cost × 1.30 (30% markup)
- Jorge can override any price
- Dashboard shows: total cost, total price, total profit, margin %
- Flags lines under 30% margin

### Step 5: Client Proposal
- Generate clean PDF: Category | Scope | Price (no costs shown)
- Same format as Jorge's Excel
- Send to client via email from the app
- Track: sent, viewed, accepted, declined

### Step 6: Won the Job → Budget Mode
- Estimate becomes the project budget
- Each line item links to:
  - Schedule phase (when it happens)
  - Sub/vendor (who's doing it)
  - Invoices (money going out)
  - Crew hours (labor cost)
- Real-time: budget vs actual per line

### Step 7: During Construction
- Sub invoices come in → matched to budget lines
- Crew hours logged → labor cost per phase
- Change orders → new lines added to budget
- Dashboard: % spent, profit tracking, cost overruns flagged

## What to Build (Priority Order)

### Phase 1: Estimate Builder ← START HERE
- New estimate page matching Jorge's Excel format
- Columns: Category | Scope | Cost | Markup % | Client Price | Profit
- Default 30% markup, overridable per line
- AI: "build an estimate for a 2-bathroom remodel" → generates all lines
- Summary: total cost, total price, total profit, margin %
- Import from walkthrough notes

### Phase 2: Sub Quote Integration
- Each estimate line can be marked "needs sub quote"
- Shows available subs for that trade
- Send quote request from the app (email to sub)
- Auto-create todo: "Follow up with [sub] on [trade] quote"
- When quote arrives via email, AI matches to estimate line
- Quote amount auto-fills the cost column

### Phase 3: Client Proposal Generator
- Generate clean client-facing proposal (PDF or email)
- Category | Scope | Price only (no internal costs)
- Professional template with company branding
- Send from app, track status

### Phase 4: Budget Tracking
- When project is "contracted", estimate → budget
- Link budget lines to schedule phases
- Track actual costs: invoices + crew labor
- Real-time profit dashboard per project
- Flag cost overruns early

### Phase 5: Change Order Management
- Add/modify scope during construction
- Change order = new budget line with markup
- Client approval flow
- Updates both budget and schedule

## Database Changes Needed
- estimate_line_items: add cost, markup_pct, profit, needs_sub_quote, sub_quote_id, status
- New: estimate_versions (track changes)
- Link: estimate_line_items → schedule_phases
- Link: estimate_line_items → quote_requests
- Link: estimate_line_items → invoices (for cost tracking)

## AI Capabilities
- Generate estimate from project description/walkthrough
- Suggest costs based on historical data (past estimates)
- Auto-match incoming sub quotes to estimate lines
- Flag when actual costs exceed budget
- Suggest schedule from estimate (already built)
