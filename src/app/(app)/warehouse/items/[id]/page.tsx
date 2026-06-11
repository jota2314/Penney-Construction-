import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { getActiveProjectsList, getWarehouseItem } from "@/lib/actions/warehouse";
import { WarehouseItemDetail } from "@/components/warehouse/warehouse-item-detail";

export const metadata: Metadata = {
  title: "Warehouse Item | Penney Construction",
};

export default async function WarehouseItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAuth();
  const { id } = await params;
  const [result, projects] = await Promise.all([
    getWarehouseItem(id),
    getActiveProjectsList(),
  ]);

  if (!result) notFound();

  return (
    <>
      <Header
        title={result.item.name}
        subtitle={result.item.sku}
        backHref="/warehouse"
      />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6 overflow-auto">
        <WarehouseItemDetail
          item={result.item}
          transactions={result.transactions}
          projects={projects}
        />
      </div>
    </>
  );
}
