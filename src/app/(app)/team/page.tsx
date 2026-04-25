import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { getTeamMembers } from "@/lib/actions/team";
import { TeamMemberCard } from "@/components/team/team-member-card";
import { CreateTeamMemberDialog } from "@/components/team/create-team-member-dialog";
import { Users } from "lucide-react";

export const metadata: Metadata = { title: "Team | Penney Construction" };

export default async function TeamPage() {
  const user = await requireAuth();
  const isOwner = user.profile?.role === "owner";
  const members = await getTeamMembers();

  const office = members.filter((m) => m.kind === "office");
  const field = members.filter((m) => m.kind === "field");

  return (
    <>
      <Header title="Team" backHref="/command-center" />
      <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 overflow-auto">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Team Directory</h2>
              <p className="text-sm text-muted-foreground">
                {members.length} member{members.length === 1 ? "" : "s"} —{" "}
                {office.length} office, {field.length} field
              </p>
            </div>
          </div>
          {isOwner && <CreateTeamMemberDialog />}
        </div>

        {office.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Office
            </h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {office.map((m) => (
                <TeamMemberCard key={m.id} member={m} />
              ))}
            </div>
          </section>
        )}

        {field.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Field
            </h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {field.map((m) => (
                <TeamMemberCard key={m.id} member={m} />
              ))}
            </div>
          </section>
        )}

        {members.length === 0 && (
          <div className="border rounded-lg p-8 text-center text-muted-foreground">
            No team members yet. Add your first member to get started.
          </div>
        )}
      </div>
    </>
  );
}
