import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import {
  listCapturesForReview,
  listCaptureJobOptions,
} from "@/lib/actions/field-capture";
import { CaptureReviewList } from "@/components/projects/capture-review-list";

export const metadata: Metadata = {
  title: "Receipts to check | Penney Construction",
};

export default async function CaptureReviewPage() {
  await requireAuth();

  const [captures, jobs] = await Promise.all([
    listCapturesForReview(),
    listCaptureJobOptions(),
  ]);

  return (
    <>
      <Header title="Receipts to check" backHref="/spent" />
      <div className="flex flex-col gap-4 p-4 sm:p-6 pb-24 sm:pb-8">
        <p className="text-sm text-muted-foreground max-w-2xl">
          Receipts the crew photographed that the AI wasn&apos;t sure about. They are
          already counted in the job&apos;s Spent — fix what&apos;s wrong and confirm, or
          discard the ones that were never a cost.
        </p>
        <CaptureReviewList captures={captures} jobs={jobs} />
      </div>
    </>
  );
}
