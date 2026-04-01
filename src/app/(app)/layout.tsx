import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { MobileBottomNav } from "@/components/layout/mobile-bottom-nav";
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
        {/* Add bottom padding on mobile so content isn't hidden behind the nav bar */}
        <div className="pb-28 md:pb-0">{children}</div>
      </SidebarInset>
      {/* Mobile bottom nav */}
      <MobileBottomNav />
    </SidebarProvider>
  );
}
