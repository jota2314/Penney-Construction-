import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import {
  getActiveProjectsList,
  getOpenCheckouts,
  getWarehouseEmployees,
  getWarehouseItems,
  getWarehouseSummary,
} from "@/lib/actions/warehouse";
import { signWarehouseThumbs } from "@/lib/warehouse/photo-urls";
import { WarehouseDashboard } from "@/components/warehouse/warehouse-dashboard";
import { WarehouseIntelligence } from "@/components/warehouse/warehouse-intelligence";
import { loadWarehouseSnapshot, warehouseIntelligenceAccess } from "@/lib/warehouse/intelligence-server";

export const metadata: Metadata = { title: "Warehouse | Penney Construction" };

export default async function WarehousePage() {
  await requireAuth();
  const supabase = await createClient();
  const intelligencePromise = warehouseIntelligenceAccess().then(async access => {
    if (!access) return null;
    return loadWarehouseSnapshot().then(snapshot => ({ snapshot, error: undefined as string | undefined }))
      .catch(() => ({ snapshot: null, error: "Warehouse intelligence could not load its source records." }));
  }).catch(() => null);
  const [items, summary, projects, checkouts, employees, intelligence] = await Promise.all([
    getWarehouseItems(),
    getWarehouseSummary(),
    getActiveProjectsList(),
    getOpenCheckouts(),
    getWarehouseEmployees(),
    intelligencePromise,
  ]);
  const thumbUrls = await signWarehouseThumbs(supabase, items);

  return (
    <>
      <Header title="Warehouse" backHref="/command-center" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6 overflow-auto">
        {intelligence && <WarehouseIntelligence {...intelligence} thumbUrls={thumbUrls} />}
        <WarehouseDashboard
          items={items}
          summary={summary}
          projects={projects}
          checkouts={checkouts}
          employees={employees}
          thumbUrls={thumbUrls}
        />
      </div>
    </>
  );
}
