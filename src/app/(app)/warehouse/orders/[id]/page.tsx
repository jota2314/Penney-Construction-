import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { getMaterialOrder } from "@/lib/actions/warehouse";
import { MaterialOrderDetail } from "@/components/warehouse/material-order-detail";

export const metadata: Metadata = {
  title: "Material Order | Penney Construction",
};

export default async function MaterialOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAuth();
  const { id } = await params;
  const result = await getMaterialOrder(id);

  if (!result) notFound();

  return (
    <>
      <Header
        title={result.order.order_number}
        subtitle={result.order.requested_by_name ?? undefined}
        backHref="/warehouse/orders"
      />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6 overflow-auto">
        <MaterialOrderDetail order={result.order} stockById={result.stockById} />
      </div>
    </>
  );
}
