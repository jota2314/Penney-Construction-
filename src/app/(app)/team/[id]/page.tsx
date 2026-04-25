import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { getTeamMemberDashboard } from "@/lib/actions/team";

export const metadata: Metadata = { title: "Team Member | Penney Construction" };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function TeamMemberPage({ params }: Props) {
  const { id } = await params;
  await requireAuth();
  const decodedId = decodeURIComponent(id);

  let dashboard: Awaited<ReturnType<typeof getTeamMemberDashboard>> = null;
  let loadError: string | null = null;
  try {
    dashboard = await getTeamMemberDashboard(decodedId);
  } catch (err) {
    loadError = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
    console.error("[/team/[id]] getTeamMemberDashboard failed:", err);
  }

  if (loadError) {
    return (
      <>
        <Header title="Team Member" backHref="/team" />
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center gap-3">
          <h2 className="text-lg font-semibold">Couldn&apos;t load this team member</h2>
          <pre className="text-xs text-red-600 dark:text-red-400 max-w-full overflow-auto bg-muted p-3 rounded whitespace-pre-wrap">
            {loadError}
          </pre>
          <p className="text-xs text-muted-foreground">id: {decodedId}</p>
        </div>
      </>
    );
  }

  if (!dashboard) notFound();

  // TEMP DIAGNOSTIC — show the loaded data so we can find what was making the
  // production render throw. Once we see the data shape we'll restore the
  // full UI with whatever fix is needed.
  let debugDump = "";
  try {
    debugDump = JSON.stringify(dashboard, null, 2);
  } catch (e) {
    debugDump = `JSON.stringify failed: ${e instanceof Error ? e.message : String(e)}`;
  }

  return (
    <>
      <Header title="Team Member (debug)" backHref="/team" />
      <div className="flex flex-1 flex-col p-4 gap-3 overflow-auto">
        <h2 className="text-sm font-semibold">
          Loaded data — render disabled to isolate the production error
        </h2>
        <p className="text-xs text-muted-foreground">id: {decodedId}</p>
        <pre className="text-xs bg-muted p-3 rounded overflow-auto whitespace-pre-wrap break-all">
          {debugDump}
        </pre>
      </div>
    </>
  );
}
