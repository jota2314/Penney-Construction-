import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { WhoopDashboard } from "@/components/whoop/whoop-dashboard";

export const metadata: Metadata = { title: "WHOOP | Penney Construction" };

export default async function WhoopPage() {
  await requireAuth();

  return (
    <>
      <Header title="WHOOP" backHref="/command-center" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6 overflow-auto">
        <WhoopDashboard />
      </div>
    </>
  );
}
