import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { getAgentCrew } from "@/lib/actions/agents";
import { AgentCrew } from "@/components/command-center/agent-crew";

export const metadata: Metadata = {
  title: "Agent Crew | Penney Construction",
};

export default async function AgentsPage() {
  await requireAuth();
  const initial = await getAgentCrew();

  return (
    <>
      <Header />
      <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6">
        <div>
          <h1 className="text-2xl font-bold">Agent Crew</h1>
          <p className="text-sm text-muted-foreground">
            Your scheduled Claude agents, working the job site. Watch what they
            do live and approve what they find.
          </p>
        </div>
        <AgentCrew initial={initial} />
      </div>
    </>
  );
}
