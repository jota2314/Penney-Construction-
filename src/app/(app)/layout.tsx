import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { requireAuth } from "@/lib/auth/require-auth";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAuth();

  return (
    <SidebarProvider>
      <AppSidebar profile={user.profile} email={user.email} />
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  );
}
