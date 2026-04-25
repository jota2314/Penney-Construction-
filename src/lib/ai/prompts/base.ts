/**
 * Base prompt — shared by ALL 4 chats.
 * Company info, team, capabilities, tool rules, current date.
 */

import { nowStamp } from "@/lib/ai/claude";
import { EMAIL_STYLE_GUIDE, getRecentSentExamples } from "@/lib/ai/email-style";
import { createClient } from "@/lib/supabase/server";

export const COMPANY_BASE = `You are an AI assistant for **Penney Construction, Inc.**, a residential general contractor on the North Shore of Massachusetts.

## Company
- Website: penneyconstructioninc.com
- Focus: High-end residential remodeling, additions, kitchens, bathrooms, new construction
- Location: North Shore MA (Beverly, Salem, Gloucester, Marblehead, etc.)

## Known Subcontractors
- MTP Electric (Chuck Pappas) — Electrical
- Pedersen Electrical (Eric Pedersen) — Electrical
- DL Services — HVAC
- Jackson Lumber (Chris Parello) — Lumber/Materials
- Building Center of Gloucester (Steve Black) — Materials
- Essex County Craftsmen (Brad Noyes) — Finish Carpentry
- Timberline (Jon Holmes) — Framing
- Wanderson Oliveira — Framing/Insulation
- Jonathan Tobar — Framing
- Joe Mello — Siding
- Marcio Silva — Tile/Demo
- Peter Nguyen — Hardwood Flooring
- Cosentino Plumbing (John Cosentino) — Plumbing
- Topcrete — Foundation/Concrete
- Carmelo — Plastering
- Weslei — Painting
- Wayne — Cabinets/Finish Carpentry
- Cameron Electric (Matt Fogarty) — Electrical

## Nickname Map (for sub dedup)
Chuck = Charles, Jon = Jonathan, Steve = Stephen, Matt = Matthew, Joe = Joseph, Brad = Bradley

## Your Capabilities
You have TOOLS to directly interact with the database and Google integrations. USE THEM — never say "I can't check that" or "I don't have access". You CAN.

### What you can DO:
- **Search & read**: Projects, customers, subs, emails, quotes, todos, schedules, invoices, payments, change orders
- **Financial data**: Get LIVE project P&L, budget vs actual per line item, labor hours + costs
- **Create**: Projects, customers, subs, todos, quotes, invoices, payments, change orders
- **Update**: Project status/details, todo status/priority, schedule phases
- **Email**: Draft emails (always show user first), send via Gmail after approval
- **Schedule**: Create Google Calendar events, add/update schedule phases

### Tool Rules:
0. **DOCUMENT AUDIENCE — NEVER CROSS THE STREAMS.** Client-facing documents contain Penney's markup and margin. Sub-facing documents do not.
   - **CLIENT-ONLY (never attach to emails going to subs/vendors):** generate_proposal, generate_proposal-pdf, generate_financial_report, generate_change_order_pdf (when it shows client price).
   - **SUB-ONLY (for sub emails):** generate_bid_package — scope + measurements + screenshots, no Penney pricing.
   - Before sending any email with an attachment, identify the recipient. If they're a sub/vendor (search_subcontractors, or their email is in the subs table, or the user called them a sub), you MUST NOT attach a proposal or financial report. Use a bid package instead.
   - The server will hard-block sends that violate this rule — don't try.
1. When asked about a project — USE search_projects or get_project_details. Don't guess.
2. When asked about money/budget/profit — USE get_project_financials for the live numbers.
3. For emails — ALWAYS use draft_email first. The user approves before sending. NEVER use send_email directly.
4. When emailing a proposal **TO THE CLIENT ONLY** — ALWAYS attach BOTH the PDF and the Excel. Include two attachments in draft_email: attachments: [{ url: "/api/generate-proposal-pdf?projectId=xxx", filename: "ProjectName - Proposal.pdf" }, { url: "/api/generate-proposal?projectId=xxx", filename: "ProjectName - Proposal.xlsx" }]. Get the client's email from get_project_details — don't ask for it. If the recipient is a sub/vendor, NEVER use these URLs — call generate_bid_package instead.
   - **CC handling:** draft_email and send_email accept a cc field. If Jorge says "cc Ryan", "include Ryan", "loop Ryan in", or similar → pass cc: "rpenney@penneyconstructioninc.com". Jorge can also toggle "+ CC Ryan" on the draft card UI, so don't worry if he adds Ryan after you've drafted.
5. **FILES / DRAWINGS / DOCUMENTS — MANDATORY WORKFLOW:**
   - Any user request involving drawings, plans, specs, files, documents, attachments — even a casual "give me the drawings for X" — requires a full tool chain:
     1. If the project name isn't already resolved in context → call search_projects to get the project_id.
     2. Call list_project_documents with that project_id.
     3. Report each matching file using EXACTLY this markdown format on its own line, with no extra text on the URL side: \`[FILENAME](OPEN_URL)\` — where OPEN_URL is the \`open_url\` field from the attachment. Do NOT paste the raw URL as text. Do NOT wrap the URL in quotes or code fences. Do NOT break the link across lines.
   - **Example correct output:** \`Here's the drawing:\n\n[Gallegos Construction Drawings.pdf](https://...supabase.co/.../Gallegos.pdf?token=xyz)\`
   - If an entry has no \`open_url\` (only storage_path), skip it — do not show storage paths to the user.
   - **NEVER claim "no drawings" or "no files" without running list_project_documents.** If the tool returns zero results, say so explicitly and name the project you searched.
   - **Construction drawings** are files in project_files with category='construction_drawings'. When Jorge opens a PDF in the takeoff viewer it's AUTO-REGISTERED there, so for any project he's been measuring on, the drawing IS in the system.
   - Also when **emailing** with attachments: call list_project_documents first, then pass attachment info (url / storage_path / drive_file_id + filename) to draft_email.
6. When the user uploads a file and asks to SAVE/STORE it in a project — use save_file_to_project with the storage_path from the attachment context. Pick the right category (construction_drawings, specs, invoices, quotes, permits, contracts, photos, other). NEVER say you can't save files.
7. When the user uploads a file and asks to SEND/EMAIL it — include it as an attachment in draft_email using the storage_path from the attachment context. NEVER tell the user to "manually attach" it.
8. When asked to "show" or "give me" a proposal/PDF/report — ALWAYS call the generate tool (generate_proposal, generate_financial_report, etc.). The system will open it and show download buttons. NEVER say you can't show a PDF.
9. Write tools show as approval cards — after calling them, acknowledge what you proposed and wait for approval. Don't call the same write tool again.
10. **SAVING CONTACTS (clients & subs) — first-class behavior:**
    - When the user says "save this contact", "add this sub/client", "save this person", "new sub", "new client", or pastes a signature / business card / list of people → save them.
    - When the user shares a new sub or client in passing ("Chuck from MTP quoted $8k", "homeowner's name is Sarah Iler, sarah@..."), PROACTIVELY offer to save them if they don't exist yet.
    - **ALWAYS dedup first.** Before creating ANY contact, search existing records. If a close match exists, tell the user and ask whether to use the existing one or add anyway — do NOT silently create a duplicate.
    - **Clients/homeowners** → FIRST call search_customers (match on name, email, phone, address — try partial matches). If no match → create_customer (first_name + last_name required; fill email, phone, address, city, state, zip if given).
    - **Subs/vendors** → FIRST call search_subcontractors (match on company name AND contact name AND email — try each separately). Check nicknames: Chuck=Charles, Jon=Jonathan, Steve=Stephen, Matt=Matthew, Joe=Joseph, Brad=Bradley. If no match → create_subcontractor (company_name required; also set contact_name, email, phone, trades array).
    - If the user just gives a name with no other info, still search first. If not found, save what you have — don't refuse. Only ask for required fields that are actually missing (last_name for customers, company_name for subs).
    - After saving, confirm with the name and ID so the user knows it's in the system.
11. Be proactive — if a project name is mentioned, look it up. If a sub is mentioned, search for their info.
12. Todos are SELF-REMINDERS for the current user — "I need to follow up", "I need to check on this". NEVER assign todos to other team members. No notification emails on todo creation.

## Response Style
- Be concise and action-oriented
- Lead with the most important information
- When suggesting actions, be specific (name the sub, the trade, the project)
- If you need more info, ask directly — don't hedge`;

/**
 * Fetch the live team roster from profiles + employees + team_invites and
 * format it as a compact reference. Included in every chat so the AI knows
 * who's on the team, their role, contact info, and hourly rate.
 */
async function getTeamContext(): Promise<string> {
  try {
    const supabase = await createClient();

    // Identify the user currently chatting so we can address them by name
    // and highlight their row in the roster.
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    const currentUserId = authUser?.id ?? null;

    const [profilesRes, invitesRes, employeesRes] = await Promise.all([
      supabase.from("profiles").select("id, email, full_name, role, phone"),
      supabase.from("team_invites").select("email, full_name, role, phone"),
      supabase
        .from("employees")
        .select("id, first_name, last_name, email, title, hourly_rate, status, profile_id")
        .eq("status", "active"),
    ]);

    const profiles = profilesRes.data ?? [];
    const invites = invitesRes.data ?? [];
    const employees = employeesRes.data ?? [];

    const currentProfile = currentUserId
      ? profiles.find((p) => p.id === currentUserId) ?? null
      : null;
    const currentEmployee = currentUserId
      ? employees.find((e) => e.profile_id === currentUserId) ?? null
      : null;

    const isTest = (e: string | null | undefined) => !!e && /betancurfx/i.test(e);
    const employeeByEmail = new Map<string, typeof employees[number]>();
    const employeeByProfileId = new Map<string, typeof employees[number]>();
    for (const e of employees) {
      if (e.email) employeeByEmail.set(e.email.toLowerCase(), e);
      if (e.profile_id) employeeByProfileId.set(e.profile_id, e);
    }

    const ROLE_LABEL: Record<string, string> = {
      owner: "Owner",
      precon_manager: "Pre-Con Manager",
      project_manager: "Project Manager",
      office_admin: "Office Admin",
      field: "Field",
    };

    type Entry = { name: string; line: string; sortKey: string };
    const office: Entry[] = [];
    const fieldOnly: Entry[] = [];
    const seenEmployeeIds = new Set<string>();

    for (const p of profiles) {
      if (isTest(p.email)) continue;
      const linkedEmp =
        employeeByProfileId.get(p.id) ||
        (p.email ? employeeByEmail.get(p.email.toLowerCase()) : undefined);
      if (linkedEmp) seenEmployeeIds.add((linkedEmp as { id?: string }).id ?? "");

      const name = p.full_name || p.email || "Unknown";
      const role = p.role ? ROLE_LABEL[p.role] || p.role : "Team";
      const isMe = p.id === currentUserId;
      const marker = isMe ? " **← YOU ARE HERE**" : "";
      const parts = [`**${name}** — ${role}`];
      if (linkedEmp?.title) parts.push(linkedEmp.title);
      if (p.email) parts.push(p.email);
      if (p.phone) parts.push(p.phone);
      if (linkedEmp?.hourly_rate != null) parts.push(`$${linkedEmp.hourly_rate}/hr`);
      office.push({ name, line: `- ${parts.join(" · ")}${marker}`, sortKey: name });
    }

    for (const inv of invites) {
      if (isTest(inv.email)) continue;
      const linkedEmp = inv.email ? employeeByEmail.get(inv.email.toLowerCase()) : undefined;
      if (linkedEmp) seenEmployeeIds.add((linkedEmp as { id?: string }).id ?? "");

      const role = inv.role ? ROLE_LABEL[inv.role] || inv.role : "Team";
      const parts = [`**${inv.full_name}** — ${role} *(pending sign-in)*`];
      if (linkedEmp?.title) parts.push(linkedEmp.title);
      if (inv.email) parts.push(inv.email);
      if (inv.phone) parts.push(inv.phone);
      if (linkedEmp?.hourly_rate != null) parts.push(`$${linkedEmp.hourly_rate}/hr`);
      office.push({ name: inv.full_name, line: `- ${parts.join(" · ")}`, sortKey: inv.full_name });
    }

    for (const e of employees) {
      const eid = (e as { id?: string }).id ?? "";
      if (seenEmployeeIds.has(eid)) continue;
      if (isTest(e.email)) continue;
      const name = `${e.first_name} ${e.last_name}`.trim();
      const isMe = !!e.profile_id && e.profile_id === currentUserId;
      const marker = isMe ? " **← YOU ARE HERE**" : "";
      const parts = [`**${name}** — Field`];
      if (e.title) parts.push(e.title);
      if (e.email) parts.push(e.email);
      if (e.hourly_rate != null) parts.push(`$${e.hourly_rate}/hr`);
      fieldOnly.push({ name, line: `- ${parts.join(" · ")}${marker}`, sortKey: name });
    }

    office.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    fieldOnly.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    const sections: string[] = [];
    if (office.length) sections.push(`### Office\n${office.map(e => e.line).join("\n")}`);
    if (fieldOnly.length) sections.push(`### Field Crew\n${fieldOnly.map(e => e.line).join("\n")}`);

    let identityHeader = "";
    if (currentProfile) {
      const fullName = currentProfile.full_name || currentProfile.email || "the user";
      const firstName = (fullName.split(/\s+/)[0] || "").trim();
      const role = currentProfile.role ? ROLE_LABEL[currentProfile.role] || currentProfile.role : "Team";
      const title = currentEmployee?.title;
      const rate =
        currentEmployee?.hourly_rate != null ? `$${currentEmployee.hourly_rate}/hr` : null;
      const bits = [role];
      if (title) bits.push(title);
      if (rate) bits.push(rate);

      identityHeader = `

## YOU ARE CHATTING WITH
**${fullName}** — ${bits.join(" · ")}${currentProfile.email ? ` · ${currentProfile.email}` : ""}

- Address them by their first name (**${firstName}**) when natural — don't open every reply with "Hi ${firstName}", but do use their name when greeting, thanking, or transitioning topics.
- Tailor advice to their role. If they're field crew, skip pricing/markup details and focus on schedule, materials, site access. If they're office/precon, surface financials, scope decisions, and client comms.
- "I" / "me" / "my" in their messages refers to **${firstName}**. When they say "remind me to call X", the todo is theirs. When they say "draft an email", it goes from them.
- Their preferences and past corrections (if any) are listed in the AI MEMORY section below — follow them.`;
    }

    if (!sections.length && !identityHeader) return "";
    const teamBlock = sections.length
      ? `\n\n## Penney Construction Team\n${sections.join("\n\n")}`
      : "";
    return `${identityHeader}${teamBlock}`;
  } catch {
    return "";
  }
}

/**
 * Fetch the current user's active work — assigned projects, open todos,
 * recent quotes / time entries — so the AI knows what they're actually
 * working on right now, not just who they are.
 */
async function getCurrentUserActivityContext(): Promise<string> {
  try {
    const supabase = await createClient();
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    if (!authUser) return "";

    const profileId = authUser.id;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const safe = (builder: PromiseLike<any>) =>
      Promise.resolve(builder).catch(() => ({ data: null, error: true }));

    const [employeeRes, projectsRes, todosRes, quotesRes, timeEntriesRes] =
      await Promise.all([
        safe(
          supabase
            .from("employees")
            .select("id, title")
            .eq("profile_id", profileId)
            .maybeSingle()
        ),
        safe(
          supabase
            .from("projects")
            .select("id, project_number, name, status, address")
            .in("status", ["lead", "estimating", "proposal_sent", "contracted", "in_progress"])
            .or(
              `assigned_pm.eq.${profileId},assigned_estimator.eq.${profileId},created_by.eq.${profileId}`
            )
            .order("updated_at", { ascending: false })
            .limit(8)
        ),
        safe(
          supabase
            .from("todos")
            .select("description, project_name, priority, due_date")
            .eq("status", "open")
            .or(`assigned_to.eq.${profileId},created_by.eq.${profileId}`)
            .order("due_date", { ascending: true, nullsFirst: false })
            .limit(10)
        ),
        safe(
          supabase
            .from("quote_requests")
            .select("subcontractor_name, trade, amount, status, created_at")
            .order("created_at", { ascending: false })
            .limit(5)
        ),
        // Field workers: load this week's time entries
        safe(
          supabase
            .from("time_entries")
            .select("clock_in, clock_out, break_minutes, projects:project_id(name)")
            .eq("employee_id", "")
            .limit(0)
        ),
      ]);

    const sections: string[] = [];

    const projects: Array<{
      project_number: string;
      name: string;
      status: string;
      address: string | null;
    }> = projectsRes.data ?? [];
    if (projects.length) {
      const lines = projects.map(
        (p) =>
          `- **${p.project_number}** — ${p.name} *(${p.status})*${p.address ? ` · ${p.address}` : ""}`
      );
      sections.push(`### Your active projects (${projects.length})\n${lines.join("\n")}`);
    }

    const todos: Array<{
      description: string;
      project_name: string | null;
      priority: string | null;
      due_date: string | null;
    }> = todosRes.data ?? [];
    if (todos.length) {
      const lines = todos.map((t) => {
        const parts = [t.description];
        if (t.project_name) parts.push(`(${t.project_name})`);
        if (t.priority && t.priority !== "normal") parts.push(`[${t.priority}]`);
        if (t.due_date) parts.push(`due ${t.due_date}`);
        return `- ${parts.join(" ")}`;
      });
      sections.push(`### Your open todos (${todos.length})\n${lines.join("\n")}`);
    }

    // Field workers (linked employee record): also load assigned projects + this week's hours
    const employee = employeeRes.data as { id?: string; title?: string } | null;
    if (employee?.id) {
      const empId = employee.id;
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
      weekStart.setHours(0, 0, 0, 0);

      const [crewRes, weekRes] = await Promise.all([
        safe(
          supabase
            .from("crew_project_assignments")
            .select("projects:project_id(project_number, name, status)")
            .eq("employee_id", empId)
            .limit(10)
        ),
        safe(
          supabase
            .from("time_entries")
            .select("clock_in, clock_out, break_minutes")
            .eq("employee_id", empId)
            .gte("clock_in", weekStart.toISOString())
        ),
      ]);

      type CrewProj = { project_number?: string; name?: string; status?: string };
      const assignments: CrewProj[] = ((crewRes.data ?? []) as Array<{ projects: unknown }>)
        .map((row): CrewProj | null => {
          const proj = Array.isArray(row.projects) ? row.projects[0] : row.projects;
          return (proj ?? null) as CrewProj | null;
        })
        .filter((p): p is CrewProj => p !== null);
      if (assignments.length) {
        const lines = assignments.map(
          (p) => `- ${p.project_number ?? "—"} — ${p.name ?? "?"} *(${p.status ?? "?"})*`
        );
        sections.push(`### Crew assignments (${assignments.length})\n${lines.join("\n")}`);
      }

      let minutes = 0;
      for (const e of (weekRes.data ?? []) as Array<{
        clock_in: string;
        clock_out: string | null;
        break_minutes: number | null;
      }>) {
        const end = e.clock_out ? new Date(e.clock_out).getTime() : Date.now();
        const ms = end - new Date(e.clock_in).getTime();
        minutes += Math.max(0, Math.floor(ms / 60000) - (e.break_minutes || 0));
      }
      const hours = Math.round((minutes / 60) * 10) / 10;
      if (hours > 0) {
        sections.push(`### Hours this week\n- ${hours}h logged so far`);
      }
    }

    void timeEntriesRes; // placeholder; avoid unused warning

    const quotes: Array<{
      subcontractor_name: string | null;
      trade: string | null;
      amount: number | null;
      status: string | null;
    }> = quotesRes.data ?? [];
    if (quotes.length) {
      const lines = quotes.slice(0, 5).map((q) => {
        const amt = q.amount ? `$${Number(q.amount).toLocaleString()}` : "no amount";
        return `- ${q.subcontractor_name ?? "?"} (${q.trade ?? "?"}) — ${amt} *(${q.status ?? "?"})*`;
      });
      sections.push(`### Recent quotes\n${lines.join("\n")}`);
    }

    if (!sections.length) return "";
    return `\n\n## WHAT YOU ARE WORKING ON\nLive snapshot of the user's queue. Reference these specifics when they ask "what's next?", "what am I behind on?", or just say a project name.\n\n${sections.join("\n\n")}`;
  } catch {
    return "";
  }
}

/**
 * Fetch the cost book (trade_rates) and format as a compact reference.
 * Included in every chat so the AI can answer pricing questions.
 */
async function getCostBookContext(): Promise<string> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("trade_rates")
      .select("trade_name, unit_type, avg_price, avg_cost")
      .eq("is_active", true)
      .order("trade_name")
      .limit(200);

    if (!data || data.length === 0) return "";

    const lines = data.map(r =>
      `  ${r.trade_name} [${r.unit_type}] — price $${Number(r.avg_price).toFixed(2)} / cost $${Number(r.avg_cost).toFixed(2)}`
    ).join("\n");

    return `\n\n## PENNEY COST BOOK (${data.length} items)\nUse these for pricing estimates, material costs, and budget discussions.\n${lines}`;
  } catch {
    return "";
  }
}

/**
 * Build the complete base prompt with current date, email style, and cost book.
 */
export async function buildBasePrompt(): Promise<string> {
  const [emailExamples, costBook, team, activity] = await Promise.all([
    getRecentSentExamples(5),
    getCostBookContext(),
    getTeamContext(),
    getCurrentUserActivityContext(),
  ]);

  return [
    COMPANY_BASE,
    team,
    activity,
    `\n\n## CURRENT DATE & TIME: ${nowStamp()}`,
    `\n\n${EMAIL_STYLE_GUIDE}`,
    emailExamples,
    costBook,
  ].join("");
}
