import type { Metadata } from "next";
import { BillWorkspace } from "@/components/finances/bill-workspace";

export const metadata: Metadata = { title: "Transaction | Penney Construction" };

export default async function SpentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return <BillWorkspace id={(await params).id} />;
}
