import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { UserPlus, Calendar, ArrowRightCircle, ArrowRight } from "lucide-react";

interface CrmStatsProps {
  newLeads: number;
  upcomingMeetings: number;
  converted: number;
}

export function CrmStats({
  newLeads,
  upcomingMeetings,
  converted,
}: CrmStatsProps) {
  const stats = [
    {
      title: "New Leads",
      count: newLeads,
      description: "Awaiting action",
      icon: UserPlus,
      href: "/crm/leads?status=new",
      color: "text-blue-600",
      bg: "bg-blue-100",
    },
    {
      title: "Upcoming Meetings",
      count: upcomingMeetings,
      description: "Scheduled",
      icon: Calendar,
      href: "/crm/meetings",
      color: "text-purple-600",
      bg: "bg-purple-100",
    },
    {
      title: "Converted",
      count: converted,
      description: "This month",
      icon: ArrowRightCircle,
      href: "/crm/leads?status=converted",
      color: "text-green-600",
      bg: "bg-green-100",
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-3">
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
  );
}
