import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { WalkthroughListPage } from "./walkthrough-list-page";

export default async function WalkthroughsPage() {
  await requireAuth();
  const supabase = await createClient();

  const [{ data: walkthroughs }, { data: estimates }] = await Promise.all([
    supabase
      .from("walkthroughs")
      .select("*")
      .order("visited_at", { ascending: false }),
    supabase
      .from("estimates")
      .select("id, name")
      .is("project_id", null)
      .in("status", ["draft", "review"])
      .order("created_at", { ascending: false }),
  ]);

  return (
    <>
      <Header title="Walkthroughs" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6">
        <WalkthroughListPage
          walkthroughs={walkthroughs ?? []}
          estimates={estimates ?? []}
        />
      </div>
    </>
  );
}
