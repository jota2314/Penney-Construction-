import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { WalkthroughListPage } from "./walkthrough-list-page";

export const metadata: Metadata = { title: "Walkthroughs | Penney Construction" };

export default async function WalkthroughsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string | string[] }>;
}) {
  await requireAuth();
  const params = await searchParams;
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
      <Header title="Walkthroughs" backHref="/command-center" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6 overflow-auto">
        <WalkthroughListPage
          walkthroughs={walkthroughs ?? []}
          estimates={estimates ?? []}
          initialFormOpen={params.new === "1"}
        />
      </div>
    </>
  );
}
