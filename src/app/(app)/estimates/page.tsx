import { Suspense } from "react";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { EstimateList } from "@/components/estimates/estimate-list";

export default async function EstimatesPage() {
  await requireAuth();
  const supabase = await createClient();

  const { data: estimates } = await supabase
    .from("estimates")
    .select("*, project:projects(name, project_number)")
    .order("created_at", { ascending: false });

  return (
    <>
      <Header title="Estimates" />
      <div className="flex flex-1 flex-col gap-6 p-6">
        <Suspense>
          <EstimateList estimates={estimates ?? []} />
        </Suspense>
      </div>
    </>
  );
}
