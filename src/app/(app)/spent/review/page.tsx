import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import {
  listCapturesForReview,
  listCaptureJobOptions,
} from "@/lib/actions/field-capture";
import { SpendOrganizer } from "@/components/finances/spend-organizer";
import { NonJobTransactions } from "@/components/finances/non-job-spend";
import { listNonJobTransactions } from "@/lib/actions/non-job-spend";

export const metadata: Metadata = {
  title: "Sort out spending | Penney Construction",
};

export default async function CaptureReviewPage() {
  await requireAuth();

  const [captures, jobs, nonJobTransactions] = await Promise.all([
    listCapturesForReview(),
    listCaptureJobOptions(),
    listNonJobTransactions(),
  ]);

  return (
    <>
      <Header title="Sort out spending" backHref="/spent" />
      <div className="flex flex-col gap-4 p-4 sm:p-6 pb-24 sm:pb-8">
        <p className="text-sm text-muted-foreground max-w-2xl">
          Review flagged receipts and transactions awaiting assignment. Costs need a job and budget line;
          use Overhead or Shop for company operating costs. For an owner draw or credit card payment/transfer,
          choose “Resolve as non-job transaction” on the individual row and confirm its reason.
        </p>
        <SpendOrganizer rows={captures} jobs={jobs} />
        <NonJobTransactions rows={nonJobTransactions} />
        <Link href="/receipts/uploads" className="text-sm underline">Saved uploads</Link>
      </div>
    </>
  );
}
