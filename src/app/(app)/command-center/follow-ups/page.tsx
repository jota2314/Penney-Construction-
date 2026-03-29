import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { getFollowUps } from "@/lib/actions/command-center";
import { FollowUpsList } from "@/components/command-center/follow-ups-list";

export const metadata: Metadata = { title: "Follow-ups | Penney Construction" };

export default async function FollowUpsPage() {
  await requireAuth();

  let followUps = await getFollowUps().catch(() => []);

  return (
    <>
      <Header title="Follow-ups" />
      <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 min-w-0 overflow-hidden">
        <FollowUpsList followUps={followUps} />
      </div>
    </>
  );
}
