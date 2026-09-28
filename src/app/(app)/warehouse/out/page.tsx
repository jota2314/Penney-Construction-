import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { getOpenCheckouts, getWarehouseEmployees } from "@/lib/actions/warehouse";
import { signWarehouseThumbs } from "@/lib/warehouse/photo-urls";
import { OutOnJobs } from "@/components/warehouse/out-on-jobs";

export const metadata: Metadata = { title: "Out on Jobs | Penney Construction" };

export default async function OutOnJobsPage() {
  await requireAuth();
  const supabase = await createClient();
  const [checkouts, employees] = await Promise.all([
    getOpenCheckouts(),
    getWarehouseEmployees(),
  ]);
  const thumbUrls = await signWarehouseThumbs(
    supabase,
    Array.from(
      new Map(
        checkouts.map((c) => [
          c.item_id,
          { id: c.item_id, photo_path: null, photo_thumb_path: c.photo_thumb_path },
        ])
      ).values()
    )
  );

  return (
    <>
      <Header title="Out on Jobs" backHref="/warehouse" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6 overflow-auto">
        <OutOnJobs checkouts={checkouts} employees={employees} thumbUrls={thumbUrls} />
      </div>
    </>
  );
}
