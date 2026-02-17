import Link from "next/link";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  Plus,
  ArrowRight,
} from "lucide-react";

export default async function DashboardPage() {
  const user = await requireAuth();
  const displayName = user.profile?.full_name?.split(" ")[0] ?? user.email;
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

  const stats = [
    {
      title: "Active Projects",
      count: projectsRes.count ?? 0,
      description: "In progress",
      icon: FolderKanban,
      href: "/projects",
      color: "text-[#E87A1D]",
      bg: "bg-[#E87A1D]/10",
    },
    {
      title: "Open Estimates",
      count: estimatesRes.count ?? 0,
      description: "Draft & review",
      icon: Calculator,
      href: "/estimates",
      color: "text-[#4A4543]",
      bg: "bg-[#4A4543]/10",
    },
    {
      title: "Pending Proposals",
      count: proposalsRes.count ?? 0,
      description: "Awaiting response",
      icon: FileText,
      href: "/projects",
      color: "text-[#E87A1D]",
      bg: "bg-[#E87A1D]/10",
    },
    {
      title: "Active Subs",
      count: subsRes.count ?? 0,
      description: "In database",
      icon: HardHat,
      href: "/subcontractors",
      color: "text-[#4A4543]",
      bg: "bg-[#4A4543]/10",
    },
  ];

  return (
    <>
      <Header title="Dashboard" />
      <div className="flex flex-1 flex-col gap-6 p-6">
        {/* Welcome */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">
              Hey {displayName}!
            </h2>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-muted-foreground text-sm">
                Here&apos;s what&apos;s happening with your projects.
              </p>
              {role && (
                <Badge className={ROLE_COLORS[role]} variant="secondary">
                  {ROLE_LABELS[role]}
                </Badge>
              )}
            </div>
          </div>
          <Button asChild>
            <Link href="/projects">
              <Plus className="mr-2 h-4 w-4" />
              New Project
            </Link>
          </Button>
        </div>

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <Link key={stat.title} href={stat.href}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    {stat.title}
                  </CardTitle>
                  <div className={`p-2 rounded-lg ${stat.bg}`}>
                    <stat.icon className={`h-4 w-4 ${stat.color}`} />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{stat.count}</div>
                  <CardDescription className="flex items-center gap-1 mt-1">
                    {stat.description}
                    <ArrowRight className="h-3 w-3" />
                  </CardDescription>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        {/* Quick actions */}
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>
              Jump right in to what you need to do.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" asChild>
                <Link href="/projects">
                  <FolderKanban className="mr-2 h-4 w-4" />
                  View Projects
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/estimates">
                  <Calculator className="mr-2 h-4 w-4" />
                  View Estimates
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/customers">
                  <FileText className="mr-2 h-4 w-4" />
                  View Customers
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/subcontractors">
                  <HardHat className="mr-2 h-4 w-4" />
                  View Subs
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
