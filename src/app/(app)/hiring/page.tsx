import type { Metadata } from "next";
import { headers } from "next/headers";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { ApplicationsBoard } from "@/components/hiring/applications-board";
import type { JobApplication } from "@/components/hiring/applications-board";

export const metadata: Metadata = { title: "Hiring | Penney Construction" };

export default async function HiringPage() {
  await requireAuth();
  const supabase = await createClient();

  const { data } = await supabase
    .from("job_applications")
    .select("*")
    .order("created_at", { ascending: false });

  const applications = (data ?? []) as JobApplication[];

  const headersList = await headers();
  const host =
    headersList.get("x-forwarded-host") || headersList.get("host") || "";
  const protocol = host.includes("localhost") ? "http" : "https";
  const applyUrl = host ? `${protocol}://${host}/apply` : "/apply";

  return (
    <>
      <Header title="Hiring" backHref="/command-center" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6 overflow-auto">
        <ApplicationsBoard applications={applications} applyUrl={applyUrl} />
      </div>
    </>
  );
}
