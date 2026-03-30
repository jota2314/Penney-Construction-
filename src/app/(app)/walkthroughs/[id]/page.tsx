import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { WalkthroughDetail } from "@/components/walkthroughs/walkthrough-detail";

export const metadata: Metadata = { title: "Walkthrough Details | Penney Construction" };

export default async function WalkthroughDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAuth();
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: walkthrough }, { data: notes }, { data: files }] =
    await Promise.all([
      supabase.from("walkthroughs").select("*").eq("id", id).single(),
      supabase
        .from("walkthrough_notes")
        .select("*")
        .eq("walkthrough_id", id)
        .order("sort_order"),
      supabase
        .from("walkthrough_files")
        .select("*")
        .eq("walkthrough_id", id)
        .order("created_at"),
    ]);

  if (!walkthrough) notFound();

  return (
    <>
      <Header title={`Walkthrough — ${walkthrough.name}`} backHref="/walkthroughs" backLabel="Walkthroughs" />
      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6 overflow-auto">
        <WalkthroughDetail
          walkthrough={walkthrough}
          notes={notes ?? []}
          files={files ?? []}
        />
      </div>
    </>
  );
}
