import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { getProjectTodos, getProjectQuotes } from "@/lib/actions/command-center";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Mail } from "lucide-react";
import { ProjectDetailTodos } from "@/components/command-center/project-detail-todos";
import { ProjectSyncButton } from "@/components/command-center/project-sync-button";
import { ProjectEmailList } from "@/components/command-center/project-email-list";

export const metadata: Metadata = { title: "Project Command Center | Penney Construction" };

const PHASE_LABELS: Record<string, string> = {
  preconstruction: "PRECONSTRUCTION",
  pre_start: "PRE-START",
  rough_in: "ROUGH-IN",
  finishing: "FINISHING",
  punch_list: "PUNCH LIST",
  complete: "COMPLETE",
  lead: "NEW LEAD",
  estimating: "ESTIMATING",
  proposal_sent: "PROPOSAL SENT",
  contracted: "CONTRACTED",
  in_progress: "IN PROGRESS",
};

const PHASE_COLORS: Record<string, string> = {
  preconstruction: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  pre_start: "bg-red-500/20 text-red-400 border-red-500/30",
  rough_in: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  finishing: "bg-green-500/20 text-green-400 border-green-500/30",
  punch_list: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  complete: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  lead: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  estimating: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  proposal_sent: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  contracted: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  in_progress: "bg-green-500/20 text-green-400 border-green-500/30",
};

interface PageProps {
  params: Promise<{ projectId: string }>;
}

export default async function ProjectDetailPage({ params }: PageProps) {
  await requireAuth();
  const { projectId } = await params;

  const supabase = await createClient();

  const [{ data: project }, todos, quotes, { data: emailLogs }] = await Promise.all([
    supabase
      .from("projects")
      .select("*, customer:customers(*)")
      .eq("id", projectId)
      .single(),
    getProjectTodos(projectId),
    getProjectQuotes(projectId),
    supabase
      .from("email_logs")
      .select("*")
      .eq("project_id", projectId)
      .order("sent_at", { ascending: false })
      .limit(50),
  ]);

  if (!project) return notFound();

  // Get subs for this project
  const { data: projectSubs } = await supabase
    .from("project_subcontractors")
    .select("subcontractor:subcontractors(company_name)")
    .eq("project_id", projectId);

  const subNames = (projectSubs ?? [])
    .map((ps: Record<string, unknown>) => {
      const sub = ps.subcontractor as { company_name: string } | null;
      return sub?.company_name;
    })
    .filter(Boolean) as string[];

  // Combine quote sub names
  const quoteSubNames = quotes.map((q) => q.subcontractor_name);
  const allSubNames = [...new Set([...subNames, ...quoteSubNames])];

  const phaseKey = project.phase || project.status;

  return (
    <>
      <Header title={project.name} backHref="/command-center" backLabel="Command Center" />
      <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6">
        {/* Header with live status */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <h2 className="text-xl font-bold">Precon Command Center</h2>
          </div>
          <span className="text-xs text-muted-foreground">
            Live &middot; Gmail + Calendar Connected
          </span>
        </div>

        {/* Navigation tabs */}
        <div className="flex gap-2 overflow-x-auto">
          <Badge variant="outline" className="bg-primary text-primary-foreground border-primary px-3 py-1">
            Projects
          </Badge>
          <Link href="/command-center">
            <Badge variant="outline" className="px-3 py-1 cursor-pointer hover:bg-accent">
              Follow-ups
            </Badge>
          </Link>
          <Link href="/command-center">
            <Badge variant="outline" className="px-3 py-1 cursor-pointer hover:bg-accent">
              Calendar
            </Badge>
          </Link>
        </div>

        {/* Back link */}
        <Link
          href="/command-center"
          className="text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to Projects
        </Link>

        {/* Project Card */}
        <Card className="border-l-4 border-l-emerald-500">
          <CardContent className="pt-6">
            <h3 className="text-xl font-bold">{project.name}</h3>
            {(project.address || project.city) && (
              <p className="text-sm text-muted-foreground mt-1">
                {[project.address, project.city].filter(Boolean).join(", ")}
              </p>
            )}
            <div className="flex flex-wrap gap-2 mt-3">
              <Badge
                variant="outline"
                className={`text-[10px] font-bold ${
                  PHASE_COLORS[phaseKey] || PHASE_COLORS.lead
                }`}
              >
                {PHASE_LABELS[phaseKey] || phaseKey.toUpperCase()}
              </Badge>
              {allSubNames.map((name) => (
                <Badge
                  key={name}
                  variant="outline"
                  className="text-[10px] font-bold bg-amber-500/20 text-amber-400 border-amber-500/30"
                >
                  {name.toUpperCase()}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-3">
          <ProjectSyncButton projectId={projectId} />
          <Button
            variant="outline"
            className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
          >
            <Mail className="h-4 w-4 mr-2" />
            Compose Email
          </Button>
        </div>

        {/* Open Todos */}
        <Card>
          <CardHeader>
            <CardTitle>Open Todos</CardTitle>
          </CardHeader>
          <CardContent>
            <ProjectDetailTodos todos={todos} />
          </CardContent>
        </Card>

        {/* Quotes for this project */}
        {quotes.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Quotes ({quotes.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {quotes.map((quote) => (
                  <div
                    key={quote.id}
                    className="rounded-lg border p-3 flex items-center justify-between"
                  >
                    <div>
                      <p className="font-medium">{quote.subcontractor_name}</p>
                      {quote.trade && (
                        <p className="text-xs text-muted-foreground">
                          {quote.trade}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      {quote.amount && (
                        <p className="font-medium">
                          ${quote.amount.toLocaleString()}
                        </p>
                      )}
                      <Badge
                        variant="outline"
                        className="text-[10px]"
                      >
                        {quote.status.replace("_", " ").toUpperCase()}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Email History */}
        <Card>
          <CardHeader>
            <CardTitle>
              Email History ({(emailLogs ?? []).length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ProjectEmailList emails={emailLogs ?? []} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
