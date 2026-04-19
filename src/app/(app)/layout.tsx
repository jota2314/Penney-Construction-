import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { MobileBottomNav } from "@/components/layout/mobile-bottom-nav";
import { FloatingChat } from "@/components/layout/floating-chat";
import { PullToRefresh } from "@/components/ui/pull-to-refresh";
import { requireAuth } from "@/lib/auth/require-auth";

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
        <PullToRefresh>{children}</PullToRefresh>
      </SidebarInset>
      {/* Mobile bottom nav */}
      <MobileBottomNav />
      {/* Floating AI chat — available on every page */}
      <FloatingChat />
    </SidebarProvider>
  );
}
