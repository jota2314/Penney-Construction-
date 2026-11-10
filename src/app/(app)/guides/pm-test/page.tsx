import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { getPmTestState } from "@/lib/actions/pm-test";
import { PmTest } from "@/components/training/pm-test";

export const metadata: Metadata = { title: "PM Training Test | Penney Construction" };

// Submitting grades the written answers with Claude before it returns, which
// runs well past the default function limit.
export const maxDuration = 180;

/**
 * The PM change-order training test. A new PM works eight real-life
 * situations on their TEST job, writes what they did, and gets a score on
 * submit: the change orders are checked from the job itself, the writing is
 * graded against a fixed key. Jorge and Ryan see everyone's results here.
 */
export default async function PmTestPage() {
  await requireAuth();
  const state = await getPmTestState();

  return (
    <>
      <Header title="PM Training Test" backHref="/guides" />
      <div className="flex flex-1 flex-col gap-5 overflow-auto p-4 sm:gap-6 sm:p-6">
        {state ? (
          <PmTest state={state} />
        ) : (
          <p className="text-sm text-muted-foreground">Your profile could not be loaded. Sign out and back in.</p>
        )}
      </div>
    </>
  );
}
