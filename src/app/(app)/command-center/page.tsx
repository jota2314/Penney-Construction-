import type { Metadata } from "next";
import { Suspense } from "react";
import { requireAuth } from "@/lib/auth/require-auth";
import type { UserRole } from "@/types/auth";
import { CommandCenterFeed, type RoleId } from "@/components/field-feed/command-center-feed";
import { getCommandCenterFeedData } from "@/lib/actions/command-center-feed";
import { getCommandCenterFocusedUpdate } from "@/lib/actions/command-center-updates";
import { getWebsiteInquirySummary } from "@/lib/actions/website-inquiries";
import { canManageWebsiteInquiries, type InquirySummary } from "@/lib/inquiries/model";
import { CommandCenterLoading } from "@/components/field-feed/command-center-loading";

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

  // Effective viewer id: when "Viewing as" someone, user.profile is the
  // impersonated profile, so profile.id is the person whose personal items
  // ("Your Day") should show. Falls back to the real signed-in user id.
  const viewerId = user.profile?.id ?? user.id;

  const canSeeInquiries = canManageWebsiteInquiries(user.profile?.email) && canManageWebsiteInquiries(user.realProfile?.email);

  // Send the authenticated greeting immediately; dashboard queries stream in
  // behind it and never cover the app's usable sidebar or bottom navigation.
  return (
    <Suspense fallback={<CommandCenterLoading firstName={firstName} />}>
      <CommandCenterContent role={role} viewerId={viewerId} firstName={firstName} canSeeInquiries={canSeeInquiries} searchParams={searchParams} />
    </Suspense>
  );
}

async function CommandCenterContent({ role, viewerId, firstName, canSeeInquiries, searchParams }: {
  role: RoleId;
  viewerId: string;
  firstName: string | null;
  canSeeInquiries: boolean;
  searchParams: Promise<{ post?: string }>;
}) {
  const [{ feed, initialUpdates }, inquiries, { post }, focusedUpdate] = await Promise.all([
    getCommandCenterFeedData(role, viewerId),
    canSeeInquiries ? getWebsiteInquirySummary().catch((): InquirySummary => ({ open: 0, new: 0, overdue: 0, unavailable: true })) : Promise.resolve(null),
    searchParams,
    searchParams.then(({ post }) => post ? getCommandCenterFocusedUpdate(post).catch(() => null) : null),
  ]);
  if (inquiries) feed.unshift({ type: "websiteInquiries", summary: inquiries });

  return (
    <CommandCenterFeed
      key={viewerId}
      roleId={role}
      firstName={firstName}
      feed={feed}
      initialUpdates={initialUpdates}
      focusedUpdate={focusedUpdate}
      focusPostId={post ?? null}
    />
  );
}
