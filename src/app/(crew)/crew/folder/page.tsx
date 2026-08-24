import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { getMyClockedInJob } from "@/lib/actions/daily-logs";
import { CrewJobFolder, type FolderJob } from "@/components/crew/crew-job-folder";

export default async function CrewFolderPage() {
  await requireAuth();
  const supabase = await createClient();

  const [{ data: jobs }, clockedIn] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, project_number, address, city, scope_of_work")
      .in("status", ["contracted", "in_progress"])
      .order("name", { ascending: true }),
    getMyClockedInJob().catch(() => null),
  ]);

  return (
    <div className="px-4 pt-4 pb-8">
      <CrewJobFolder
        jobs={(jobs ?? []) as FolderJob[]}
        initialJobId={clockedIn?.id ?? null}
      />
    </div>
  );
}
