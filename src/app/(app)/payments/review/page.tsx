import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import {
  listPaymentsForReview,
  listPaymentJobOptions,
} from "@/lib/actions/deposit-capture";
import { PaymentReviewList } from "@/components/projects/payment-review-list";

export const metadata: Metadata = {
  title: "Payments to check | Penney Construction",
};

export default async function PaymentReviewPage() {
  await requireAuth();

  const [payments, jobs] = await Promise.all([
    listPaymentsForReview(),
    listPaymentJobOptions(),
  ]);

  return (
    <>
      <Header title="Payments to check" backHref="/payments" />
      <div className="flex flex-col gap-4 p-4 sm:p-6 pb-24 sm:pb-8">
        <p className="text-sm text-muted-foreground max-w-2xl">
          Client payments logged off a check photo that the AI wasn&apos;t sure about.
          They already count toward the job — fix what&apos;s wrong and confirm, or
          discard the ones that were never a payment.
        </p>
        <PaymentReviewList payments={payments} jobs={jobs} />
      </div>
    </>
  );
}
