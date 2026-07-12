import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/require-auth";
import type { UserRole } from "@/types/auth";
import { CommandCenterFeed, type RoleId } from "@/components/field-feed/command-center-feed";
import { getCommandCenterFeedData } from "@/lib/actions/command-center-feed";

export const metadata: Metadata = { title: "Command Center | Penney Construction" };

const ROLE_MAP: Record<UserRole, RoleId> = {
  owner: "owner",
  precon_manager: "estimator",
  project_manager: "lead",
  office_admin: "admin",
  field: "crew",
};

export default async function CommandCenterPage({
  searchParams,
}: {
  searchParams: Promise<{ post?: string }>;
}) {
  const user = await requireAuth();
  const role: RoleId = ROLE_MAP[user.profile?.role ?? "precon_manager"] ?? "estimator";
  const firstName =
    user.profile?.full_name?.trim().split(/\s+/)[0] ??
    user.profile?.email?.split("@")[0] ??
    null;

  const { post } = await searchParams;
  const { feed, jobsites } = await getCommandCenterFeedData(role);

  return (
    <CommandCenterFeed
      roleId={role}
      firstName={firstName}
      feed={feed}
      jobsites={jobsites}
      focusPostId={post ?? null}
    />
  );
}
