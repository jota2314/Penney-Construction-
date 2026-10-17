import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { getSubRollout } from "@/lib/actions/sub-portal";
import { SubRolloutTable } from "@/components/subcontractors/sub-rollout-table";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sub portal rollout | Penney Construction" };

/**
 * Bringing subs onto the portal: who should be on it, who has a cell (the
 * login), who was invited and who shows up. Office roles only.
 */
export default async function SubPortalRolloutPage() {
  const user = await requireAuth();
  if (!user.profile || user.profile.role === "field") redirect("/crew");

  const { data, error } = await getSubRollout();

  return (
    <>
      <Header title="Sub portal rollout" backHref="/subcontractors" backLabel="Subcontractors" />
      <div className="flex flex-1 flex-col gap-4 overflow-auto p-4 sm:p-6">
        {error || !data ? (
          <p className="text-sm text-red-500">{error ?? "Couldn't load the rollout list."}</p>
        ) : (
          <SubRolloutTable data={data} />
        )}
      </div>
    </>
  );
}
