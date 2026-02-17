import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ROLE_LABELS, ROLE_COLORS } from "@/lib/constants/roles";
import {
  FolderKanban,
  Calculator,
  HardHat,
  FileText,
} from "lucide-react";

export default async function DashboardPage() {
  const user = await requireAuth();
  const displayName = user.profile?.full_name ?? user.email;
  const role = user.profile?.role;

  const supabase = await createClient();

  const [projectsRes, estimatesRes, proposalsRes, subsRes] = await Promise.all([
    supabase
      .from("projects")
      .select("*", { count: "exact", head: true })
      .in("status", ["lead", "estimating", "proposal_sent", "contracted", "in_progress"]),
    supabase
      .from("estimates")
      .select("*", { count: "exact", head: true })
      .in("status", ["draft", "review"]),
    supabase
      .from("proposals")
      .select("*", { count: "exact", head: true })
      .eq("status", "sent"),
    supabase
      .from("subcontractors")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true),
  ]);

  return (
    <>
      <Header title="Dashboard" />
      <div className="flex flex-1 flex-col gap-6 p-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Welcome back, {displayName}
          </h2>
          <p className="text-muted-foreground">
            {role && (
              <Badge className={ROLE_COLORS[role]} variant="secondary">
                {ROLE_LABELS[role]}
              </Badge>
            )}
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Active Projects
              </CardTitle>
              <FolderKanban className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{projectsRes.count ?? 0}</div>
              <CardDescription>Projects in progress</CardDescription>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Open Estimates
              </CardTitle>
              <Calculator className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{estimatesRes.count ?? 0}</div>
              <CardDescription>Estimates in draft/review</CardDescription>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Pending Proposals
              </CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{proposalsRes.count ?? 0}</div>
              <CardDescription>Awaiting customer response</CardDescription>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Active Subs
              </CardTitle>
              <HardHat className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{subsRes.count ?? 0}</div>
              <CardDescription>Subcontractors in database</CardDescription>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>
              Your latest project and estimating activity will appear here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              No recent activity yet. Start by creating a project.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
