import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { getProjectFiles } from "@/lib/actions/project-files";
import { ProjectPricing } from "@/components/projects/project-pricing";

export const metadata: Metadata = { title: "Pricing & Specs | Penney Construction" };

export default async function PricingPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuth();
  const { id } = await params;
  const supabase = await createClient();
  const { data: project } = await supabase.from("projects").select("id, name").eq("id", id).single();
  if (!project) notFound();
  const allFiles = await getProjectFiles(id);
  const pricingFiles = allFiles.filter(f => f.category === "pricing" || f.category === "specs");

  return (
    <>
      <Header title={`Pricing & Specs — ${project.name}`} backHref={`/projects/${id}/estimates`} />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6">
        <ProjectPricing projectId={id} files={pricingFiles} />
      </div>
    </>
  );
}
