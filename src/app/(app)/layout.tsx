import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { requireAuth } from "@/lib/auth/require-auth";
import { getMode } from "@/lib/mode/get-mode";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAuth();
  const mode = await getMode();

  return (
    <SidebarProvider>
      <AppSidebar profile={user.profile} email={user.email} mode={mode} />
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  );
}
