import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { requireAuth } from "@/lib/auth/require-auth";
import { getTeamMemberDashboard } from "@/lib/actions/team";
import { ROLE_LABELS, ROLE_COLORS } from "@/lib/constants/roles";
import { Mail, Phone, DollarSign, CalendarCheck, UserCircle2 } from "lucide-react";
import type { UserRole } from "@/types/auth";

export const metadata: Metadata = { title: "Team Member | Penney Construction" };

const BUILD_MARKER = "TEAM-DETAIL-BUILD-2026-04-25-STAGE1";

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "?"
  );
}

function safeNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

interface Props {
  params: Promise<{ id: string }>;
}

export default async function TeamMemberPage({ params }: Props) {
  const { id } = await params;
  await requireAuth();
  const decodedId = decodeURIComponent(id);

  let dashboard: Awaited<ReturnType<typeof getTeamMemberDashboard>> = null;
  let loadError: string | null = null;
  try {
    dashboard = await getTeamMemberDashboard(decodedId);
  } catch (err) {
    loadError = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
    console.error("[/team/[id]] getTeamMemberDashboard failed:", err);
  }

  if (loadError) {
    return (
      <>
        <Header title="Team Member" backHref="/team" />
        <div className="flex flex-1 flex-col p-4 gap-3 text-xs">
          <p className="font-mono text-amber-500">{BUILD_MARKER}</p>
          <pre className="text-red-500 max-w-full overflow-auto whitespace-pre-wrap bg-muted p-3 rounded">
            {loadError}
          </pre>
        </div>
      </>
    );
  }

  if (!dashboard) notFound();

  const { member } = dashboard;
  const memberRole = member.role as UserRole | null;
  const hourlyRate = safeNumber(member.hourly_rate);
  const fullName = member.full_name || member.email || "Unknown";

  let hireDateLabel: string | null = null;
  if (member.hire_date) {
    const d = new Date(member.hire_date);
    if (!Number.isNaN(d.getTime())) hireDateLabel = d.toLocaleDateString();
  }

  return (
    <>
      <Header title={fullName} subtitle="Team Member" backHref="/team" />
      <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 overflow-auto">
        <p className="font-mono text-[10px] text-amber-500">{BUILD_MARKER}</p>

        <Card className="p-6">
          <div className="flex items-start gap-4 flex-wrap">
            <Avatar className="h-20 w-20">
              <AvatarImage src={member.avatar_url ?? undefined} alt={fullName} />
              <AvatarFallback className="text-xl">{initials(fullName)}</AvatarFallback>
            </Avatar>

            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold">{fullName}</h1>
                {memberRole && ROLE_LABELS[memberRole] && (
                  <Badge className={ROLE_COLORS[memberRole]} variant="secondary">
                    {ROLE_LABELS[memberRole]}
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
                {hourlyRate !== null && (
                  <span className="inline-flex items-center gap-1.5">
                    <DollarSign className="h-4 w-4" />
                    ${hourlyRate.toFixed(2)}/hr
                  </span>
                )}
                {hireDateLabel && (
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarCheck className="h-4 w-4" />
                    Hired {hireDateLabel}
                  </span>
                )}
              </div>
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
      </div>
    </>
  );
}
