import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ROLE_LABELS, ROLE_COLORS } from "@/lib/constants/roles";
import { Mail, Phone, Clock, UserCircle2 } from "lucide-react";
import type { TeamMember } from "@/lib/actions/team";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function TeamMemberCard({ member }: { member: TeamMember }) {
  return (
    <Link href={`/team/${encodeURIComponent(member.id)}`} className="block group">
      <Card className="h-full p-5 rounded-xl border transition-all duration-200 hover:border-amber-500/40 hover:shadow-md hover:-translate-y-0.5 cursor-pointer">
        <div className="flex items-start gap-4">
          <Avatar className="h-14 w-14 shrink-0">
            <AvatarImage src={member.avatar_url ?? undefined} alt={member.full_name} />
            <AvatarFallback className="text-base">{initials(member.full_name)}</AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 mb-1">
              <h3 className="font-semibold truncate group-hover:text-amber-600 transition-colors">
                {member.full_name}
              </h3>
              {member.kind === "field" ? (
                <Badge variant="outline" className="text-[10px] shrink-0">
                  Field
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] shrink-0">
                  Office
                </Badge>
              )}
            </div>

            {member.title && (
              <p className="text-sm text-muted-foreground truncate">{member.title}</p>
            )}

            <div className="flex flex-wrap gap-1.5 mt-2">
              {member.role && (
                <Badge className={ROLE_COLORS[member.role]} variant="secondary">
                  {ROLE_LABELS[member.role]}
                </Badge>
              )}
              {member.is_pending_invite && (
                <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-400">
                  <UserCircle2 className="h-3 w-3 mr-1" />
                  Pending invite
                </Badge>
              )}
              {!member.email && (
                <Badge variant="outline" className="text-muted-foreground">
                  No email
                </Badge>
              )}
            </div>

            <div className="mt-3 space-y-1 text-xs text-muted-foreground">
              {member.email && (
                <div className="flex items-center gap-1.5 truncate">
                  <Mail className="h-3 w-3 shrink-0" />
                  <span className="truncate">{member.email}</span>
                </div>
              )}
              {member.phone && (
                <div className="flex items-center gap-1.5">
                  <Phone className="h-3 w-3 shrink-0" />
                  <span>{member.phone}</span>
                </div>
              )}
              {member.hourly_rate !== null && (
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3 w-3 shrink-0" />
                  <span>${member.hourly_rate.toFixed(2)}/hr</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
}
