import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { getGuideLibrary } from "@/lib/actions/how-to-guides";
import { GuidesLibrary } from "@/components/guides/guides-library";

export const metadata: Metadata = { title: "How-To Guides | Penney Construction" };

/**
 * How-To Guides — one place where the office and the PMs open every training
 * guide (Ryan's 9/27 ask). Tapping a guide opens its PDF full screen.
 * `?open=<guide id>` opens one straight away, so a guide can be linked from
 * an email.
 */
export default async function GuidesPage({
  searchParams,
}: {
  searchParams: Promise<{ open?: string }>;
}) {
  const user = await requireAuth();
  const [{ guides, canEdit }, { open }] = await Promise.all([getGuideLibrary(), searchParams]);
  const firstName = (user.profile?.full_name ?? "").split(" ")[0] || "";

  return (
    <>
      <Header title="How-To Guides" backHref="/command-center" />
      <div className="flex flex-1 flex-col gap-5 sm:gap-6 p-4 sm:p-6 overflow-auto">
        <GuidesLibrary
          guides={guides}
          canEdit={canEdit}
          initialOpenId={open ?? null}
          defaultAuthor={firstName}
        />
      </div>
    </>
  );
}
