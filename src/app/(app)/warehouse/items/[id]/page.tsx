import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import {
  getActiveProjectsList,
  getWarehouseAccess,
  getWarehouseEmployees,
  getWarehouseItem,
} from "@/lib/actions/warehouse";
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
  const [result, projects, employees, access] = await Promise.all([
    getWarehouseItem(id),
    getActiveProjectsList(),
    getWarehouseEmployees(),
    getWarehouseAccess(),
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
          openCheckouts={result.openCheckouts}
          photoUrl={result.photoUrl}
          canManagePhotos={access.canManagePhotos}
          projects={projects}
          employees={employees}
        />
      </div>
    </>
  );
}
