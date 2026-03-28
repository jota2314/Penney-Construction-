import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { getQuoteRequests, getQuoteStatusCounts } from "@/lib/actions/command-center";
import { QuotesPageClient } from "./quotes-client";

export default async function QuotesPage() {
  await requireAuth();

  const [quotes, statusCounts] = await Promise.all([
    getQuoteRequests().catch(() => []),
    getQuoteStatusCounts().catch(() => ({})),
  ]);

  return (
    <>
      <Header title="Quotes" />
      <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 min-w-0 overflow-hidden">
        <QuotesPageClient quotes={quotes} statusCounts={statusCounts} />
      </div>
    </>
  );
}
