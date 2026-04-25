import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { getTeamMemberDashboard } from "@/lib/actions/team";

export const metadata: Metadata = { title: "Team Member | Penney Construction" };

const BUILD_MARKER = "TEAM-DETAIL-BUILD-2026-04-25-NUKE";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function TeamMemberPage({ params }: Props) {
  const { id } = await params;
  const user = await requireAuth();
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
        <div className="flex flex-1 flex-col p-4 gap-3 text-xs">
          <p className="font-mono text-amber-500">{BUILD_MARKER}</p>
          <p className="font-semibold">getTeamMemberDashboard threw:</p>
          <pre className="text-red-500 max-w-full overflow-auto whitespace-pre-wrap bg-muted p-3 rounded">
            {loadError}
          </pre>
          <p className="text-muted-foreground">id: {decodedId}</p>
        </div>
      </>
    );
  }

  if (!dashboard) notFound();

  // Aggressive nuke: render ONLY scalar text. No Card, Avatar, Badge,
  // NavigationTile, or icons. If this page renders, the bug is in one
  // of those. If it still 500s, the bug is upstream (layout / auth /
  // module-level import chain).
  return (
    <>
      <Header title="Team Member" backHref="/team" />
      <div className="flex flex-1 flex-col p-4 gap-3 text-xs font-mono overflow-auto">
        <p className="text-amber-500 text-sm">{BUILD_MARKER}</p>
        <p>user.id: {user.id}</p>
        <p>user.role: {user.profile?.role ?? "(none)"}</p>
        <p>decodedId: {decodedId}</p>
        <p>member.full_name: {dashboard.member.full_name ?? "(null)"}</p>
        <p>member.email: {dashboard.member.email ?? "(null)"}</p>
        <p>member.role: {String(dashboard.member.role)}</p>
        <p>member.kind: {dashboard.member.kind}</p>
        <p>member.profile_id: {dashboard.member.profile_id ?? "(null)"}</p>
        <p>member.employee_id: {dashboard.member.employee_id ?? "(null)"}</p>
        <p>has office: {dashboard.office ? "yes" : "no"}</p>
        <p>has field: {dashboard.field ? "yes" : "no"}</p>
        <details className="mt-4">
          <summary>full dashboard JSON</summary>
          <pre className="mt-2 whitespace-pre-wrap break-all">
            {JSON.stringify(dashboard, null, 2)}
          </pre>
        </details>
      </div>
    </>
  );
}
