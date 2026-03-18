import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { getTeamMembers } from "@/lib/actions/projects";
import { ProjectDetail } from "@/components/projects/project-detail";
import type { ActivityItem } from "@/components/projects/project-activity-feed";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAuth();
  const { id } = await params;
  const supabase = await createClient();

  const [
    { data: project },
    { data: customers },
    { data: estimates },
    { data: siteVisits },
    { data: schedulePhases },
    { data: projectSubs },
    teamMembers,
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
      .select("*")
      .eq("project_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("project_subcontractors")
      .select("*, subcontractor:subcontractors(company_name)")
      .eq("project_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
    getTeamMembers(),
  ]);

  if (!project) notFound();

  // Fetch customer if linked
  let customer = null;
  if (project.customer_id) {
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

  // Resolve team member names
  const pmName =
    teamMembers.find((m) => m.id === project.assigned_pm)?.full_name ?? null;
  const estimatorName =
    teamMembers.find((m) => m.id === project.assigned_estimator)?.full_name ??
    null;

  // Build activity feed from existing data
  const userMap = new Map(teamMembers.map((m) => [m.id, m.full_name ?? m.email]));
  const activity: ActivityItem[] = [];

  // Project created
  activity.push({
    id: `proj-created-${project.id}`,
    type: "project_created",
    title: "Project created",
    description: project.name,
    timestamp: project.created_at,
    userName: userMap.get(project.created_by) ?? null,
  });

  // Estimates
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

  // Site visits
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

  // Schedule phases
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

  // Subcontractors assigned
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

  // Sort by timestamp descending, take latest 20
  activity.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
  const recentActivity = activity.slice(0, 20);

  return (
    <>
      <Header title={`${project.project_number} — ${project.name}`} />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6">
        <ProjectDetail
          project={project}
          customer={customer}
          customers={customers ?? []}
          teamMembers={teamMembers}
          pmName={pmName}
          estimatorName={estimatorName}
          estimates={estimates ?? []}
          activityItems={recentActivity}
          meetings={meetings}
        />
      </div>
    </>
  );
}
