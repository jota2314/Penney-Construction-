import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { MobileBottomNav } from "@/components/layout/mobile-bottom-nav";
import { FloatingChat } from "@/components/layout/floating-chat";
import { UploadQueueBanner } from "@/components/schedule/upload-queue-banner";
import { ImpersonationBanner } from "@/components/layout/impersonation-banner";
import { PullToRefresh } from "@/components/ui/pull-to-refresh";
import { requireAuth } from "@/lib/auth/require-auth";
import { ROLE_LABELS } from "@/lib/constants/roles";
import { canManageFeed } from "@/lib/auth/feed-permissions";
import { FeedPermissionsProvider } from "@/components/providers/feed-permissions-provider";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAuth();

  return (
    <FeedPermissionsProvider canManage={canManageFeed(user.email)}>
    <SidebarProvider>
      {/* Desktop sidebar — hidden on mobile */}
      <div className="hidden md:contents">
        <AppSidebar profile={user.profile} email={user.email} />
      </div>
      <SidebarInset>
        {user.isImpersonating && user.profile && (
          <ImpersonationBanner
            impersonatingName={user.profile.full_name ?? user.profile.email}
            impersonatingRole={user.profile.role ? ROLE_LABELS[user.profile.role] : null}
          />
        )}
        <PullToRefresh>{children}</PullToRefresh>
      </SidebarInset>
      {/* Mobile bottom nav */}
      <MobileBottomNav
        role={user.profile?.role ?? null}
        email={user.profile?.email ?? user.email}
      />
      {/* Floating AI chat — available on every page */}
      <FloatingChat />
      {/* Background upload progress for daily-log photos — survives
          composer dismiss and route navigation. */}
      <UploadQueueBanner />
    </SidebarProvider>
    </FeedPermissionsProvider>
  );
}
