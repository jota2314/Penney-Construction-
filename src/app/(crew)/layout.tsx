import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { CrewHeader } from "@/components/crew/crew-header";
import { CrewBottomNav } from "@/components/crew/crew-bottom-nav";
import { FloatingChat } from "@/components/layout/floating-chat";
import { ImpersonationBanner } from "@/components/layout/impersonation-banner";
import { UploadQueueBanner } from "@/components/schedule/upload-queue-banner";
import { ROLE_LABELS } from "@/lib/constants/roles";

export default async function CrewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAuth();

  // Only field workers should access crew routes
  if (user.profile?.role !== "field") {
    redirect("/command-center");
  }

  // The warehouse runner is field crew, but his day is a route between sites
  // rather than a shift on one, so the crew nav swaps to Route + Warehouse.
  const supabase = await createClient();
  const { data: employee } = await supabase
    .from("employees")
    .select("title")
    .eq("profile_id", user.profile?.id ?? user.id)
    .maybeSingle();
  const isRunner = /warehouse|runner/i.test(employee?.title ?? "");

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {user.isImpersonating && user.profile && (
        <ImpersonationBanner
          impersonatingName={user.profile.full_name ?? user.profile.email}
          impersonatingRole={user.profile.role ? ROLE_LABELS[user.profile.role] : null}
        />
      )}
      <CrewHeader
        fullName={user.profile?.full_name || null}
        avatarUrl={user.profile?.avatar_url || null}
      />
      <main className="flex-1 pb-20">{children}</main>
      <CrewBottomNav isRunner={isRunner} />
      <FloatingChat />
      <UploadQueueBanner />
    </div>
  );
}
