import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { canViewJobBoard, canSeeBoardMoney } from "@/lib/auth/role-access";
import { getBoardData } from "@/lib/board/board-data";
import { JobBoard } from "@/components/board/job-board";

export const metadata: Metadata = { title: "Job Board | Penney Construction" };

/**
 * The job board — every active job, its schedule, its weather, and its health.
 *
 * Open to the office since 8/22 (owner, precon, office admin, PM) so it can
 * run on the shop TV. Money is gated separately: contract values and change-
 * order amounts only render for owners and precon. Field crew never reach
 * here — middleware sends role `field` to /crew, where their own schedule is.
 *
 * Returns 404 rather than redirecting, same posture as /design: someone who
 * shouldn't be here gets no signal the route exists. Middleware
 * (canAccessPath) blocks it first; this is the second layer.
 */
export default async function BoardPage() {
  const user = await requireAuth();
  const viewer = { role: user.profile?.role, email: user.profile?.email ?? user.email };
  if (!canViewJobBoard(viewer)) notFound();

  const data = await getBoardData(canSeeBoardMoney(viewer.role));

  return (
    <>
      <Header title="Job Board" backHref="/command-center" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-3 sm:p-4">
        <JobBoard data={data} />
      </div>
    </>
  );
}
