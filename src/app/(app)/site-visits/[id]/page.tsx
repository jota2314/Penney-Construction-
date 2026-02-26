import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { SiteVisitDetail } from "@/components/site-visits/site-visit-detail";

export default async function SiteVisitDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAuth();
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: siteVisit }, { data: notes }, { data: files }] =
    await Promise.all([
      supabase.from("site_visits").select("*").eq("id", id).single(),
      supabase
        .from("site_visit_notes")
        .select("*")
        .eq("site_visit_id", id)
        .order("sort_order"),
      supabase
        .from("site_visit_files")
        .select("*")
        .eq("site_visit_id", id)
        .order("created_at"),
    ]);

  if (!siteVisit) notFound();

  // Fetch the project
  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", siteVisit.project_id)
    .single();

  if (!project) notFound();

  return (
    <>
      <Header
        title={`Site Visit — ${project.name}`}
      />
      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
        <SiteVisitDetail
          siteVisit={siteVisit}
          project={project}
          notes={notes ?? []}
          files={files ?? []}
        />
      </div>
    </>
  );
}
