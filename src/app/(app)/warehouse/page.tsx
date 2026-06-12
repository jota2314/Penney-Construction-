import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import {
  getActiveProjectsList,
  getWarehouseItems,
  getWarehouseSummary,
} from "@/lib/actions/warehouse";
import { WarehouseDashboard } from "@/components/warehouse/warehouse-dashboard";

export const metadata: Metadata = { title: "Warehouse | Penney Construction" };

export default async function WarehousePage() {
  await requireAuth();
  const [items, summary, projects] = await Promise.all([
    getWarehouseItems(),
    getWarehouseSummary(),
    getActiveProjectsList(),
  ]);

  return (
    <>
      <Header title="Warehouse" backHref="/command-center" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6 overflow-auto">
        <WarehouseDashboard items={items} summary={summary} projects={projects} />
      </div>
    </>
  );
}
