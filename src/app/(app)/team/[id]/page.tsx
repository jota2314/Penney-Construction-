import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { requireAuth } from "@/lib/auth/require-auth";
import { getTeamMemberDashboard } from "@/lib/actions/team";
import { ROLE_LABELS, ROLE_COLORS } from "@/lib/constants/roles";
import { NavigationTile } from "@/components/command-center/navigation-tile";
import { EditTeamMemberForm } from "@/components/team/edit-team-member-form";
import { ImpersonateButton } from "@/components/team/impersonate-button";
import { IMPERSONATION_ALLOWED_EMAIL } from "@/lib/auth/impersonation";
import {
  FolderKanban,
  Calculator,
  Bell,
  FileText,
  Clock,
  DollarSign,
  CalendarCheck,
  Mail,
  Phone,
  UserCircle2,
} from "lucide-react";

export const metadata: Metadata = { title: "Team Member | Penney Construction" };

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

interface Props {
  params: Promise<{ id: string }>;
}

export default async function TeamMemberPage({ params }: Props) {
  const { id } = await params;
  const user = await requireAuth();
  const decodedId = decodeURIComponent(id);
  const dashboard = await getTeamMemberDashboard(decodedId);

  if (!dashboard) notFound();

  const { member, office, field } = dashboard;
  const isOwner = user.profile?.role === "owner";
  const isSelf = member.profile_id === user.id;
  const canEdit = isOwner || isSelf;
  const canEditWorkInfo = isOwner;
  const canImpersonate =
    !user.isImpersonating &&
    user.realProfile?.email?.toLowerCase() === IMPERSONATION_ALLOWED_EMAIL &&
    !!member.profile_id &&
    member.profile_id !== user.id;

  return (
    <>
      <Header title={member.full_name} subtitle="Team Member" backHref="/team" />
      <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 overflow-auto">
        <Card className="p-6">
          <div className="flex items-start gap-4 flex-wrap">
            <Avatar className="h-20 w-20">
              <AvatarImage src={member.avatar_url ?? undefined} alt={member.full_name} />
              <AvatarFallback className="text-xl">{initials(member.full_name)}</AvatarFallback>
            </Avatar>

            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold">{member.full_name}</h1>
                {member.role && (
                  <Badge className={ROLE_COLORS[member.role]} variant="secondary">
                    {ROLE_LABELS[member.role]}
                  </Badge>
                )}
                <Badge variant="outline">{member.kind === "office" ? "Office" : "Field"}</Badge>
                {member.is_pending_invite && (
                  <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-400">
                    <UserCircle2 className="h-3 w-3 mr-1" />
                    Pending invite
                  </Badge>
                )}
              </div>

              {member.title && (
                <p className="text-sm text-muted-foreground">{member.title}</p>
              )}

              <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-muted-foreground pt-1">
                {member.email && (
                  <span className="inline-flex items-center gap-1.5">
                    <Mail className="h-4 w-4" />
                    {member.email}
                  </span>
                )}
                {member.phone && (
                  <span className="inline-flex items-center gap-1.5">
                    <Phone className="h-4 w-4" />
                    {member.phone}
                  </span>
                )}
                {member.hourly_rate !== null && (
                  <span className="inline-flex items-center gap-1.5">
                    <DollarSign className="h-4 w-4" />
                    ${member.hourly_rate.toFixed(2)}/hr
                  </span>
                )}
                {member.hire_date && (
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarCheck className="h-4 w-4" />
                    Hired {new Date(member.hire_date).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>

            <div className="shrink-0 flex flex-col gap-2 items-end">
              {canImpersonate && member.profile_id && (
                <ImpersonateButton profileId={member.profile_id} fullName={member.full_name} />
              )}
              {canEdit && (
                <EditTeamMemberForm member={member} canEditRole={canEditWorkInfo} />
              )}
            </div>
          </div>
        </Card>

        {member.is_pending_invite && (
          <Card className="p-6 border-amber-500/30 bg-amber-500/5">
            <div className="flex items-start gap-3">
              <UserCircle2 className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold">Waiting for first sign-in</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {member.email ? (
                    <>
                      This profile will be linked automatically when{" "}
                      <span className="font-medium">{member.email}</span> signs in
                      with Google.
                    </>
                  ) : (
                    <>
                      No email on file yet. Add an email via Edit and they&apos;ll be
                      able to log in.
                    </>
                  )}
                </p>
              </div>
            </div>
          </Card>
        )}

        {office && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Office workload
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <NavigationTile
                title="Active Projects"
                icon={FolderKanban}
                iconColorClass="bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400"
                metric={office.activeProjects}
                metricLabel="projects"
                href={member.profile_id ? `/projects?assigned=${member.profile_id}` : undefined}
              />
              <NavigationTile
                title="Pending Estimates"
                icon={Calculator}
                iconColorClass="bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400"
                metric={office.pendingEstimates}
                metricLabel="drafts"
                href={member.profile_id ? `/estimates?createdBy=${member.profile_id}` : undefined}
              />
              <NavigationTile
                title="Open Follow-ups"
                icon={Bell}
                iconColorClass="bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400"
                metric={office.openFollowUps}
                metricLabel="todos"
                href={member.profile_id ? `/command-center/todos?assigned=${member.profile_id}` : undefined}
              />
              <NavigationTile
                title="Recent Quotes"
                icon={FileText}
                iconColorClass="bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400"
                metric={office.recentQuotes}
                metricLabel="last 30d"
              />
            </div>
          </section>
        )}

        {field && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Field work
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <NavigationTile
                title="Hours This Week"
                icon={Clock}
                iconColorClass="bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400"
                metric={field.hoursThisWeek}
                metricLabel="hours"
              />
              <NavigationTile
                title="Active Projects"
                icon={FolderKanban}
                iconColorClass="bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400"
                metric={field.activeProjects}
                metricLabel="assigned"
              />
              <NavigationTile
                title="Time Entries"
                icon={CalendarCheck}
                iconColorClass="bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400"
                metric={field.timeEntriesLast14d}
                metricLabel="last 14d"
              />
              <NavigationTile
                title="Earnings This Week"
                icon={DollarSign}
                iconColorClass="bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400"
                metric={
                  field.hourlyRate !== null ? `$${field.earningsThisWeek.toFixed(0)}` : "—"
                }
                metricLabel={
                  field.hourlyRate !== null ? `at $${field.hourlyRate}/hr` : "no rate set"
                }
              />
            </div>
          </section>
        )}

        {!office && !field && (
          <Separator />
        )}
      </div>
    </>
  );
}
