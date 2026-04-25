import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { MobileBottomNav } from "@/components/layout/mobile-bottom-nav";
import { FloatingChat } from "@/components/layout/floating-chat";
import { ImpersonationBanner } from "@/components/layout/impersonation-banner";
import { PullToRefresh } from "@/components/ui/pull-to-refresh";
import { requireAuth } from "@/lib/auth/require-auth";
import { ROLE_LABELS } from "@/lib/constants/roles";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAuth();

  return (
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
      <MobileBottomNav />
      {/* Floating AI chat — available on every page */}
      <FloatingChat />
    </SidebarProvider>
  );
}
