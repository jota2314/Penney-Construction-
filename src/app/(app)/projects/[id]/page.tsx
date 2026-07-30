import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { canManageProjectDocuments } from "@/lib/auth/project-document-access";
import { canReviewEstimates } from "@/lib/auth/role-access";
import {
  getRateVisibility,
  maskTimeEntryRates,
} from "@/lib/auth/rate-visibility";
import { getScopedProjectIds } from "@/lib/auth/scoped-projects";
import { createClient } from "@/lib/supabase/server";
import { pickCurrentEstimate } from "@/lib/estimates/current";
import { getTeamMembers } from "@/lib/actions/projects";
import { getProjectFiles } from "@/lib/actions/project-files";
import { getProjectPunchList } from "@/lib/actions/punch-list";
import { fetchTimeEntriesCompat } from "@/lib/crew/time-entries-compat";
import { ProjectDetailTabs } from "@/components/projects/project-detail-tabs";
import type { ActivityItem } from "@/components/projects/project-activity-feed";

export const metadata: Metadata = { title: "Project Details | Penney Construction" };

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAuth();
  const { id } = await params;
  const supabase = await createClient();
  const canManageDocuments = canManageProjectDocuments(user.profile?.role);

  // PMs can only open their own jobs
  const scopedIds = await getScopedProjectIds(supabase, user.profile);
  if (scopedIds !== null && !scopedIds.has(id)) notFound();

  // Fetch all data in parallel
  const [
    { data: project },
    { data: customers },
    { data: estimates },
    { data: siteVisits },
    { data: schedulePhases },
    { data: projectSubs },
    { data: linkedEmails },
    { data: quoteRequests },
    { data: invoices },
    { data: paymentsReceived },
    { data: changeOrders },
    { data: clientInvoices },
    { data: budgetVsActual },
    { data: paymentMilestones },
    uploadedFiles,
    teamMembers,
    { data: timeEntries },
    { data: walkthroughs },
    { data: tradeBudgets },
    { data: subDirectory },
  ] = await Promise.all([
    supabase.from("projects").select("*").eq("id", id).single(),
    supabase.from("customers").select("*").order("last_name"),
    supabase
      .from("estimates")
      .select("*")
      .eq("project_id", id)
      .order("version", { ascending: false }),
    supabase
      .from("site_visits")
      .select("*")
      .eq("project_id", id)
      .order("visited_at", { ascending: false })
      .limit(10),
    supabase
      .from("schedule_phases")
      .select("id, name, description, start_date, end_date, planned_start_date, planned_end_date, status, color, event_type, notes, sort_order, phase_scope, estimate_line_item_id, assigned_employee_ids, assigned_sub_ids, is_confirmed, confirmed_with, created_at, created_by")
      .eq("project_id", id)
      .order("start_date"),
    supabase
      .from("project_subcontractors")
      .select("*, subcontractor:subcontractors(company_name)")
      .eq("project_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("inbox_emails")
      .select("id, gmail_message_id, subject, from_name, from_email, to_name, to_email, date, direction, snippet, is_processed, attachments")
      .eq("project_id", id)
      .order("date", { ascending: false }),
    canManageDocuments
      ? supabase
          .from("quote_requests")
          .select("*")
          .eq("project_id", id)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    supabase
      .from("invoices")
      .select("*")
      .eq("project_id", id)
      .order("invoice_date", { ascending: false }),
    supabase
      .from("payments_received")
      .select("*")
      .eq("project_id", id)
      .order("received_date", { ascending: false }),
    supabase
      .from("change_orders")
      .select("*")
      .eq("project_id", id)
      .order("change_order_number"),
    supabase
      .from("client_invoices")
      .select("*")
      .eq("project_id", id)
      .order("invoice_number"),
    supabase
      .from("budget_vs_actual")
      .select("*")
      .eq("project_id", id)
      .order("sort_order"),
    supabase
      .from("project_payment_milestones")
      .select("id, sort_order, label, stage_key, percent, amount, status, client_invoice_id")
      .eq("project_id", id)
      .order("sort_order"),
    canManageDocuments ? getProjectFiles(id) : Promise.resolve([]),
    getTeamMembers(),
    fetchTimeEntriesCompat(supabase, { projectId: id }).then((data) => ({ data })),
    supabase
      .from("walkthroughs")
      .select("*")
      .eq("project_id", id)
      .order("visited_at", { ascending: false }),
    canManageDocuments
      ? supabase
          .from("project_trade_budgets")
          .select("*")
          .eq("project_id", id)
      : Promise.resolve({ data: [] }),
    canManageDocuments
      ? supabase
          .from("subcontractors")
          .select("id, company_name, contact_name, email, phone, trades")
          .eq("is_active", true)
          .order("company_name")
      : Promise.resolve({ data: [] }),
  ]);

  if (!project) notFound();

  // Contract signing + lock state (migration 00107 columns on `projects`).
  // Countersigning binds the company to a price, so the role check happens
  // here on the server — the client only ever sees the resolved boolean.
  const contractRow = project as unknown as Record<string, unknown>;
  const contractState = {
    status: (contractRow.contract_status as string | null) ?? null,
    estimateId: (contractRow.contract_estimate_id as string | null) ?? null,
    sentAt: (contractRow.contract_sent_to_client_at as string | null) ?? null,
    viewedAt: (contractRow.contract_client_viewed_at as string | null) ?? null,
    viewCount: (contractRow.contract_client_view_count as number | null) ?? null,
    clientSignature: (contractRow.contract_client_signature as string | null) ?? null,
    clientSignedAt: (contractRow.contract_client_signed_at as string | null) ?? null,
    countersignedName: (contractRow.contract_countersigned_name as string | null) ?? null,
    countersignedAt: (contractRow.contract_countersigned_at as string | null) ?? null,
    lockedAmount:
      contractRow.contract_locked_amount != null
        ? Number(contractRow.contract_locked_amount)
        : null,
    lockedAt: (contractRow.contract_locked_at as string | null) ?? null,
    signedPdfPath: (contractRow.contract_signed_pdf_path as string | null) ?? null,
    canCountersign: canReviewEstimates(user.profile?.role),
  };

  // Daily logs for this project (rendered IG-style on the Production tab)
  const { listRecentDailyLogs } = await import("@/lib/actions/daily-logs");
  const projectDailyLogs = canManageDocuments
    ? await listRecentDailyLogs(50, id).catch(() => [])
    : [];

  type ProjectUpdateRow = {
    id: string;
    body: string;
    author_id: string;
    mentioned_profile_ids: string[];
    created_at: string;
  };
  const { data: projectUpdateRows } = await supabase
    .from("project_updates")
    .select("id, body, author_id, mentioned_profile_ids, created_at")
    .eq("project_id", id)
    .order("created_at", { ascending: false })
    .limit(50);
  const projectUpdates = (projectUpdateRows ?? []) as ProjectUpdateRow[];

  // Punch list items (open + done)
  const punchList = await getProjectPunchList(id);

  // File keys the user has hidden ("remove from project") on the Files tab
  const { getDismissedFileKeys } = await import("@/lib/actions/project-files");
  const dismissedFileKeys = canManageDocuments
    ? await getDismissedFileKeys(id).catch(() => [])
    : [];

  // Active employees (used by the Schedule tab "Assign to" picker)
  const { data: activeEmployees } = await supabase
    .from("employees")
    .select("id, first_name, last_name, title")
    .eq("status", "active")
    .order("first_name");
  const employeeOptions = (activeEmployees ?? []).map((e) => ({
    id: e.id,
    first_name: e.first_name,
    last_name: e.last_name,
    title: e.title ?? null,
  }));

  // Estimate line items for this project (used by the Schedule tab line-item picker)
  let estimateLineItems: { id: string; description: string; trade: string | null }[] = [];
  // The CURRENT estimate only — stamped contract estimate first, else highest
  // live version (one rule everywhere, see pickCurrentEstimate). Pulling every
  // version rendered each line once per estimate and put dead line ids in the
  // Schedule picker. Section headers are organizational rows, not link targets.
  const currentEstimateId = pickCurrentEstimate(
    estimates ?? [],
    (contractRow.contract_estimate_id as string | null) ?? null,
  )?.id;
  if (currentEstimateId) {
    const { data: lis } = await supabase
      .from("estimate_line_items")
      .select("id, description, trade, sort_order")
      .eq("estimate_id", currentEstimateId)
      .not("is_section_header", "is", true)
      .order("sort_order", { ascending: true });
    estimateLineItems = (lis ?? []).map((li) => ({ id: li.id, description: li.description, trade: li.trade ?? null }));
  }

  // Fetch live project financials
  let projectFinancials = null;
  try {
    const { data: fin } = await supabase.rpc("get_project_financials", { p_project_id: id });
    projectFinancials = fin;
  } catch { /* financials function may not exist yet */ }

  // Fetch all customers linked to this project via the join table.
  // Primary first (is_primary=true), then co-owners by created_at.
  // The legacy `customer` variable below remains the primary contact
  // so existing UI code that reads it keeps working.
  let linkedCustomers: NonNullable<typeof customers>[number][] = [];
  {
    const { data: links } = await supabase
      .from("project_customers")
      .select("customer_id, is_primary, created_at")
      .eq("project_id", id)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true });

    const customerIds = (links ?? []).map((l) => l.customer_id);
    if (customerIds.length > 0) {
      const { data: linkedData } = await supabase
        .from("customers")
        .select("*")
        .in("id", customerIds);
      const byId = new Map((linkedData ?? []).map((c) => [c.id, c]));
      linkedCustomers = (links ?? [])
        .map((l) => byId.get(l.customer_id))
        .filter((c): c is NonNullable<typeof c> => !!c);
    }
  }

  // Primary customer — first linkedCustomer if present, otherwise
  // fall back to projects.customer_id (covers any project the
  // backfill may have missed).
  let customer = linkedCustomers[0] ?? null;
  if (!customer && project.customer_id) {
    const { data } = await supabase
      .from("customers")
      .select("*")
      .eq("id", project.customer_id)
      .single();
    customer = data;
  }

  // Fetch meetings from the lead that was converted to this project
  let meetings: { id: string; scheduled_at: string; status: string; address: string | null; city: string | null; summary: string | null }[] = [];
  const { data: lead } = await supabase
    .from("leads")
    .select("id")
    .eq("project_id", id)
    .maybeSingle();

  if (lead) {
    const { data: meetingData } = await supabase
      .from("meetings")
      .select("id, scheduled_at, status, address, city, summary")
      .eq("lead_id", lead.id)
      .order("scheduled_at", { ascending: false });
    meetings = meetingData ?? [];
  }

  // Load conversations linked to this project's emails
  const emailIds = (linkedEmails ?? []).map((e) => e.id);
  let conversations: { email_id: string; message_count: number }[] = [];
  if (emailIds.length > 0) {
    const { data: convos } = await supabase
      .from("conversations")
      .select("id, inbox_email_id")
      .in("inbox_email_id", emailIds);

    if (convos && convos.length > 0) {
      const convoIds = convos.map((c) => c.id);
      const { data: msgCounts } = await supabase
        .from("conversation_messages")
        .select("conversation_id")
        .in("conversation_id", convoIds);

      const countMap = new Map<string, number>();
      for (const msg of msgCounts ?? []) {
        countMap.set(msg.conversation_id, (countMap.get(msg.conversation_id) ?? 0) + 1);
      }

      conversations = convos.map((c) => ({
        email_id: c.inbox_email_id,
        message_count: countMap.get(c.id) ?? 0,
      }));
    }
  }

  // Resolve team member names
  const pmName =
    teamMembers.find((m) => m.id === project.assigned_pm)?.full_name ?? null;
  const estimatorName =
    teamMembers.find((m) => m.id === project.assigned_estimator)?.full_name ??
    null;

  // Build activity feed
  const userMap = new Map(teamMembers.map((m) => [m.id, m.full_name ?? m.email]));
  const activity: ActivityItem[] = [];

  activity.push({
    id: `proj-created-${project.id}`,
    type: "project_created",
    title: "Project created",
    description: project.name,
    timestamp: project.created_at,
    userName: userMap.get(project.created_by) ?? null,
  });

  for (const est of estimates ?? []) {
    const fmt = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });
    activity.push({
      id: `est-${est.id}`,
      type: "estimate",
      title: `Estimate ${est.status === "approved" ? "approved" : "created"}: ${est.name}`,
      description: `Version ${est.version} — ${fmt.format(est.total_price)}`,
      timestamp: est.updated_at ?? est.created_at,
      userName: userMap.get(est.created_by) ?? null,
    });
  }

  for (const sv of siteVisits ?? []) {
    activity.push({
      id: `sv-${sv.id}`,
      type: "site_visit",
      title: `Site visit${sv.status === "completed" ? " completed" : ""}`,
      description: sv.purpose ?? sv.name ?? null,
      timestamp: sv.visited_at,
      userName: userMap.get(sv.created_by) ?? null,
    });
  }

  for (const phase of schedulePhases ?? []) {
    activity.push({
      id: `phase-${phase.id}`,
      type: "schedule_phase",
      title: `Phase added: ${phase.name}`,
      description: `${phase.start_date} to ${phase.end_date}`,
      timestamp: phase.created_at,
      userName: userMap.get(phase.created_by) ?? null,
    });
  }

  for (const ps of projectSubs ?? []) {
    const sub = Array.isArray(ps.subcontractor)
      ? ps.subcontractor[0]
      : ps.subcontractor;
    const companyName = sub?.company_name ?? "Subcontractor";
    const fmt = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });
    activity.push({
      id: `sub-${ps.id}`,
      type: "subcontractor",
      title: `${companyName} assigned`,
      description: ps.contract_amount ? `Contract: ${fmt.format(ps.contract_amount)}` : null,
      timestamp: ps.created_at,
    });
  }

  for (const log of projectDailyLogs) {
    activity.push({
      id: `daily-log-${log.id}`,
      type: "daily_log",
      title: log.status === "in_progress" ? "Crew clocked in" : "Daily log",
      description: log.text,
      timestamp: log.ended_at ?? log.started_at,
      userName: log.author_name ?? log.author_email,
      phaseName: log.phase_name || null,
      photoUrls: log.photo_signed_urls,
    });
  }

  for (const update of projectUpdates) {
    activity.push({
      id: `project-update-${update.id}`,
      type: "project_update",
      title: "Team update",
      description: update.body,
      timestamp: update.created_at,
      userName: userMap.get(update.author_id) ?? null,
      mentionedNames: update.mentioned_profile_ids
        .map((profileId) => userMap.get(profileId))
        .filter((name): name is string => Boolean(name))
        .map((name) => name.split(" ")[0]),
    });
  }

  activity.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
  const recentActivity = activity.slice(0, 20);

  // Transform time entries for finances tab. Office-team rates are masked
  // for viewers outside the office-rate set.
  const rateVis = await getRateVisibility(user);
  const formattedTimeEntries = maskTimeEntryRates(rateVis, timeEntries ?? []).map((te) => {
    const emp = Array.isArray(te.employees) ? te.employees[0] : te.employees;
    return {
      id: te.id,
      employee_id: te.employee_id ?? "",
      employee_name: emp ? `${emp.first_name} ${emp.last_name}` : "Unknown",
      hourly_rate: emp?.hourly_rate ?? null,
      clock_in: te.clock_in,
      clock_out: te.clock_out,
      break_minutes: te.break_minutes,
    };
  });

  // Collect attachments from linked emails, collapsing the SAME physical file
  // re-attached across a thread. Gmail re-sends prior attachments on every
  // reply/forward, and each message stores its own copy under a different
  // storage_path (`${gmail_message_id}/${name}`), so one document otherwise
  // shows up once per email it ever appeared in. Dedup by filename+size+mime,
  // preferring a copy that actually has a storage_path (so Preview/Download
  // still work). Display-only — no rows or storage objects are touched.
  type EmailAttachment = { filename: string; mimeType: string; size: number; storage_path: string | null };
  const fileByKey = new Map<string, { emailId: string; emailSubject: string; emailDate: string; filename: string; mimeType: string; size: number; storage_path: string | null }>();
  for (const email of linkedEmails ?? []) {
    const atts = (email.attachments as EmailAttachment[] | null) ?? [];
    for (const att of atts) {
      const key = `${(att.filename || "").toLowerCase()}|${att.size ?? 0}|${att.mimeType ?? ""}`;
      const candidate = {
        emailId: email.id,
        emailSubject: email.subject,
        emailDate: email.date,
        filename: att.filename,
        mimeType: att.mimeType,
        size: att.size,
        storage_path: att.storage_path,
      };
      const existing = fileByKey.get(key);
      if (!existing) {
        fileByKey.set(key, candidate);
      } else if (!existing.storage_path && candidate.storage_path) {
        // Keep the copy we can actually open.
        fileByKey.set(key, candidate);
      }
    }
  }
  const allFiles = Array.from(fileByKey.values());

  return (
    <>
      <Header title={project.name} subtitle={project.project_number} backHref="/projects" backLabel="Projects" tabBackLabel="Overview" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto p-4 pb-24 sm:gap-6 sm:p-6">
        <ProjectDetailTabs
          project={project}
          customer={customer}
          linkedCustomers={linkedCustomers}
          customers={customers ?? []}
          teamMembers={teamMembers}
          pmName={pmName}
          estimatorName={estimatorName}
          estimates={estimates ?? []}
          activityItems={recentActivity}
          meetings={meetings}
          linkedEmails={linkedEmails ?? []}
          quoteRequests={quoteRequests ?? []}
          invoices={invoices ?? []}
          paymentsReceived={paymentsReceived ?? []}
          changeOrders={changeOrders ?? []}
          clientInvoices={clientInvoices ?? []}
          budgetVsActual={budgetVsActual ?? []}
          paymentMilestones={paymentMilestones ?? []}
          financials={projectFinancials}
          projectFiles={allFiles}
          uploadedFiles={uploadedFiles}
          dismissedFileKeys={dismissedFileKeys}
          conversations={conversations}
          timeEntries={formattedTimeEntries}
          schedulePhases={schedulePhases ?? []}
          estimateLineItems={estimateLineItems}
          employeeOptions={employeeOptions}
          dailyLogs={projectDailyLogs}
          walkthroughs={walkthroughs ?? []}
          punchList={punchList}
          userId={user?.id || ""}
          canManageDocuments={canManageDocuments}
          tradeBudgets={tradeBudgets ?? []}
          subDirectory={subDirectory ?? []}
          contract={contractState}
        />
      </div>
    </>
  );
}
