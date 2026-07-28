import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { EosTabs } from "@/components/eos/eos-tabs";
import { getEosContext } from "@/lib/eos/queries";

export const metadata: Metadata = { title: "EOS | Penney Construction" };

export default async function EosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Leadership-only. RLS enforces this at the data layer too — this is
  // just so a non-member gets bounced instead of an empty page.
  const ctx = await getEosContext();
  if (!ctx) redirect("/command-center");

  return (
    <>
      <Header title="EOS" subtitle={ctx.team.name} backHref="/command-center" />
      <EosTabs />
      <div className="flex flex-1 flex-col gap-4 overflow-auto p-4 pb-24 sm:gap-6 sm:p-6 sm:pb-24">
        {children}
      </div>
    </>
  );
}
