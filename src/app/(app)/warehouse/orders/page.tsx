import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { getMaterialOrders } from "@/lib/actions/warehouse";
import { MaterialOrdersBoard } from "@/components/warehouse/material-orders-board";

export const metadata: Metadata = {
  title: "Material Orders | Penney Construction",
};

export default async function MaterialOrdersPage() {
  await requireAuth();
  const orders = await getMaterialOrders();

  return (
    <>
      <Header title="Material Orders" backHref="/warehouse" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6 overflow-auto">
        <MaterialOrdersBoard orders={orders} />
      </div>
    </>
  );
}
