"use server";

import { createClient } from "@/lib/supabase/server";
import {
  fetchRecentEmails,
  fetchProjectEmails,
  categorizeEmail,
  matchEmailToProject,
  extractQuoteInfo,
  type ParsedEmail,
  type EmailCategory,
} from "@/lib/google/gmail-sync";
import { loadSubDirectory, matchSubId } from "@/lib/subs/resolve-subcontractor";

interface SyncResult {
  emailsProcessed: number;
  quotesFound: number;
  todosCreated: number;
  projectsMatched: number;
  errors: string[];
}

/**
 * Full Gmail sync — pulls all recent emails, categorizes them,
 * matches to projects, extracts quotes, and populates the DB.
 */
export async function syncGmailInbox(): Promise<SyncResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const result: SyncResult = {
    emailsProcessed: 0,
    quotesFound: 0,
    todosCreated: 0,
    projectsMatched: 0,
    errors: [],
  };

  try {
    // 1. Fetch emails from Gmail
    const emails = await fetchRecentEmails(100);

    // 2. Get existing data for matching
    const [{ data: projects }, { data: subs }, { data: customers }] =
      await Promise.all([
        supabase
          .from("projects")
          .select("id, name, address, city, customer:customers(first_name, last_name)")
          .in("status", ["lead", "estimating", "proposal_sent", "contracted", "in_progress"]),
        supabase.from("subcontractors").select("email, company_name").eq("is_active", true),
        supabase.from("customers").select("email, first_name, last_name"),
      ]);

    // Scope deduplication to this Gmail batch so PostgREST's 1,000-row cap
    // cannot silently omit older log rows.
    const gmailMessageIds = emails.map((email) => email.id);
    const { data: existingLogs } = await supabase
      .from("email_logs")
      .select("gmail_message_id")
      .in("gmail_message_id", gmailMessageIds);

    const projectList = (projects ?? []).map((p: Record<string, unknown>) => {
      const customer = p.customer as { first_name: string; last_name: string } | null;
      return {
        id: p.id as string,
        name: p.name as string,
        address: p.address as string | null,
        city: p.city as string | null,
        customer_name: customer
          ? `${customer.first_name} ${customer.last_name}`
          : null,
      };
    });

    const subEmails = (subs ?? [])
      .map((s) => s.email)
      .filter(Boolean) as string[];

    const clientEmails = (customers ?? [])
      .map((c) => c.email)
      .filter(Boolean) as string[];

    // Track existing gmail_message_ids to avoid duplicates
    const existingIds = new Set(
      (existingLogs ?? []).map((l) => l.gmail_message_id)
    );

    // Loaded lazily on the first quote so non-quote syncs skip the query.
    let subDirectory: Awaited<ReturnType<typeof loadSubDirectory>> | null = null;

    // 3. Process each email
    for (const email of emails) {
      if (existingIds.has(email.id)) continue; // Skip duplicates

      try {
        // Categorize
        const category = categorizeEmail(email, subEmails, clientEmails);

        // Match to project
        const matchedProject = matchEmailToProject(email, projectList);
        if (matchedProject) result.projectsMatched++;

        // Log the email
        await supabase.from("email_logs").insert({
          gmail_message_id: email.id,
          subject: email.subject.substring(0, 500),
          from_email: email.fromEmail,
          to_email: email.toEmail,
          direction: email.direction,
          category,
          project_id: matchedProject?.id || null,
          sent_at: email.date,
        });

        result.emailsProcessed++;

        // If it's a quote email, extract and create a quote request
        if (category === "quote") {
          const quoteData = extractQuoteInfo(email);
          subDirectory ??= await loadSubDirectory(supabase);

          await supabase.from("quote_requests").insert({
            project_id: matchedProject?.id || null,
            subcontractor_name: quoteData.subcontractorName,
            subcontractor_id: matchSubId(subDirectory, quoteData.subcontractorName),
            project_name:
              matchedProject?.name || quoteData.projectName || "Unmatched",
            trade: quoteData.trade,
            scope_description: quoteData.description,
            amount: quoteData.amount,
            status: quoteData.amount ? "received" : "awaiting_reply",
            sent_at: email.date,
            received_at: email.direction === "inbound" ? email.date : null,
            gmail_message_id: email.id,
            created_by: user.id,
          });

          result.quotesFound++;
        }

        // If it looks like something needing follow-up, create a todo
        if (category === "follow_up" || needsFollowUp(email, category)) {
          await supabase.from("todos").insert({
            project_id: matchedProject?.id || null,
            project_name: matchedProject?.name || null,
            contact_name: extractSenderName(email.from),
            contact_type: category === "sub_outreach" ? "subcontractor" : "client",
            description: `Re: ${email.subject.substring(0, 100)}`,
            status: "open",
            priority: "medium",
            created_by: user.id,
          });

          result.todosCreated++;
        }
      } catch (err) {
        result.errors.push(
          `Error processing email "${email.subject}": ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // 4. Generate client update entries for active projects
    await generateClientUpdateEntries(supabase, user.id, projectList);
  } catch (err) {
    result.errors.push(
      `Sync error: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  return result;
}

/**
 * Sync emails for a specific project — searches Gmail for project-related emails.
 */
export async function syncProjectEmails(projectId: string): Promise<SyncResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const result: SyncResult = {
    emailsProcessed: 0,
    quotesFound: 0,
    todosCreated: 0,
    projectsMatched: 0,
    errors: [],
  };

  // Get project info
  const { data: project } = await supabase
    .from("projects")
    .select("id, name, address, city, customer:customers(first_name, last_name, email)")
    .eq("id", projectId)
    .single();

  if (!project) throw new Error("Project not found");

  const [{ data: subs }, { data: existingLogs }] = await Promise.all([
    supabase.from("subcontractors").select("email").eq("is_active", true),
    supabase
      .from("email_logs")
      .select("gmail_message_id")
      .eq("project_id", projectId),
  ]);

  const subEmails = (subs ?? []).map((s) => s.email).filter(Boolean) as string[];
  const customerArr = project.customer as unknown as { first_name: string; last_name: string; email: string | null }[] | null;
  const customer = customerArr?.[0] ?? null;
  const clientEmails = customer?.email ? [customer.email] : [];
  const existingIds = new Set((existingLogs ?? []).map((l) => l.gmail_message_id));
  let subDirectory: Awaited<ReturnType<typeof loadSubDirectory>> | null = null;

  try {
    const emails = await fetchProjectEmails(
      project.name as string,
      project.address as string | undefined
    );

    for (const email of emails) {
      if (existingIds.has(email.id)) continue;

      try {
        const category = categorizeEmail(email, subEmails, clientEmails);

        await supabase.from("email_logs").insert({
          gmail_message_id: email.id,
          subject: email.subject.substring(0, 500),
          from_email: email.fromEmail,
          to_email: email.toEmail,
          direction: email.direction,
          category,
          project_id: projectId,
          sent_at: email.date,
        });

        result.emailsProcessed++;

        if (category === "quote") {
          const quoteData = extractQuoteInfo(email);
          subDirectory ??= await loadSubDirectory(supabase);

          await supabase.from("quote_requests").insert({
            project_id: projectId,
            subcontractor_name: quoteData.subcontractorName,
            subcontractor_id: matchSubId(subDirectory, quoteData.subcontractorName),
            project_name: project.name as string,
            trade: quoteData.trade,
            scope_description: quoteData.description,
            amount: quoteData.amount,
            status: quoteData.amount ? "received" : "awaiting_reply",
            sent_at: email.date,
            received_at: email.direction === "inbound" ? email.date : null,
            gmail_message_id: email.id,
            created_by: user.id,
          });

          result.quotesFound++;
        }
      } catch (err) {
        result.errors.push(
          `Error: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  } catch (err) {
    result.errors.push(
      `Fetch error: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  return result;
}

// ── Helpers ──────────────────────────────────────

function needsFollowUp(email: ParsedEmail, category: EmailCategory): boolean {
  // Inbound emails from subs/clients that might need a response
  if (email.direction !== "inbound") return false;
  if (category === "internal" || category === "other") return false;

  const body = email.body.toLowerCase();
  return (
    body.includes("?") ||
    body.includes("let me know") ||
    body.includes("please confirm") ||
    body.includes("get back to") ||
    body.includes("waiting") ||
    body.includes("when can")
  );
}

function extractSenderName(from: string): string {
  const match = from.match(/^"?([^"<]+)"?\s*</);
  if (match) return match[1].trim();
  const emailMatch = from.match(/^([^@]+)@/);
  if (emailMatch) return emailMatch[1].replace(/[._-]/g, " ");
  return from;
}

async function generateClientUpdateEntries(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  projects: { id: string; name: string; customer_name: string | null }[]
) {
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
  weekStart.setHours(0, 0, 0, 0);
  const weekStartStr = weekStart.toISOString().split("T")[0];

  // Check which projects already have client update entries this week
  const { data: existing } = await supabase
    .from("client_updates")
    .select("project_id")
    .gte("week_start", weekStartStr);

  const existingProjectIds = new Set(
    (existing ?? []).map((e) => e.project_id)
  );

  // Create entries for projects that don't have one yet
  const newEntries = projects
    .filter((p) => !existingProjectIds.has(p.id) && p.customer_name)
    .map((p) => ({
      project_id: p.id,
      client_name: p.customer_name!,
      week_start: weekStartStr,
      status: "pending" as const,
      created_by: userId,
    }));

  if (newEntries.length > 0) {
    await supabase.from("client_updates").insert(newEntries);
  }
}
