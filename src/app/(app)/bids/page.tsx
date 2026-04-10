import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { getBidPackages } from "@/lib/actions/bids";
import { BidDashboard } from "@/components/bids/bid-dashboard";

export const metadata: Metadata = { title: "Bids | Penney Construction" };

export default async function BidsPage() {
  await requireAuth();
  const packages = await getBidPackages();

  return (
    <>
      <Header title="Bid Management" backHref="/command-center" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6 overflow-auto">
        <BidDashboard packages={packages} />
      </div>
    </>
  );
}
