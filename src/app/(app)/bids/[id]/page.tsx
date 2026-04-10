import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { getBidPackage } from "@/lib/actions/bids";
import { BidPackageDetail } from "@/components/bids/bid-package-detail";

export const metadata: Metadata = { title: "Bid Package | Penney Construction" };

export default async function BidDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuth();
  const { id } = await params;
  const pkg = await getBidPackage(id);

  if (!pkg) notFound();

  return (
    <>
      <Header
        title={`${pkg.trade} — ${pkg.projects?.name || pkg.name}`}
        backHref="/bids"
      />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6 overflow-auto">
        <BidPackageDetail pkg={pkg} />
      </div>
    </>
  );
}
