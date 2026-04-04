import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { DriveEstimateImporter } from "@/components/projects/drive-estimate-importer";

export const metadata: Metadata = { title: "Import Estimates | Penney Construction" };

export default async function ImportEstimatesPage() {
  await requireAuth();
  const supabase = await createClient();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, project_number")
    .in("status", ["lead", "estimating", "proposal_sent", "contracted", "in_progress"])
    .order("name");

  return (
    <>
      <Header title="Import Estimates from Google Drive" backHref="/command-center" />
      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6 overflow-auto">
        <DriveEstimateImporter projects={projects ?? []} />
      </div>
    </>
  );
}
