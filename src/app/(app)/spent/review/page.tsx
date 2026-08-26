import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import {
  listCapturesForReview,
  listCaptureJobOptions,
} from "@/lib/actions/field-capture";
import { SpendOrganizer } from "@/components/finances/spend-organizer";

export const metadata: Metadata = {
  title: "Sort out spending | Penney Construction",
};

export default async function CaptureReviewPage() {
  await requireAuth();

  const [captures, jobs] = await Promise.all([
    listCapturesForReview(),
    listCaptureJobOptions(),
  ]);

  return (
    <>
      <Header title="Sort out spending" backHref="/spent" />
      <div className="flex flex-col gap-4 p-4 sm:p-6 pb-24 sm:pb-8">
        <p className="text-sm text-muted-foreground max-w-2xl">
          Every cost that still needs a home — flagged receipts and bank lines
          with no job. Pick a vendor on the left, check the rows, point them at a
          job and budget line in one shot. ★ Overhead and Shop are at the top of
          the job list for costs that were never job costs.
        </p>
        <SpendOrganizer rows={captures} jobs={jobs} />
      </div>
    </>
  );
}
