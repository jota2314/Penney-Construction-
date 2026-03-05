"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { HardHat, Phone, Mail } from "lucide-react";
import type { SchedulePhase, Subcontractor } from "@/types/database";

interface ProjectSubcontractorsSectionProps {
  phases: SchedulePhase[];
  subcontractors: Subcontractor[];
}

export function ProjectSubcontractorsSection({
  phases,
  subcontractors,
}: ProjectSubcontractorsSectionProps) {
  // Build map: subId → phase names
  const subPhaseMap = new Map<string, string[]>();
  for (const phase of phases) {
    for (const subId of phase.assigned_sub_ids ?? []) {
      const existing = subPhaseMap.get(subId) ?? [];
      existing.push(phase.name);
      subPhaseMap.set(subId, existing);
    }
  }

  // Only show subs assigned to at least one phase
  const assignedSubs = subcontractors.filter((s) => subPhaseMap.has(s.id));

  if (assignedSubs.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <HardHat className="h-5 w-5" />
          Subcontractors ({assignedSubs.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="divide-y">
          {assignedSubs.map((sub) => (
            <div
              key={sub.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-3 first:pt-0 last:pb-0"
            >
              <div className="space-y-1">
                <p className="font-medium">{sub.company_name}</p>
                <div className="flex flex-wrap gap-1">
                  {(subPhaseMap.get(sub.id) ?? []).map((phaseName) => (
                    <Badge
                      key={phaseName}
                      variant="secondary"
                      className="text-xs"
                    >
                      {phaseName}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                {sub.contact_name && <span>{sub.contact_name}</span>}
                {sub.phone && (
                  <span className="flex items-center gap-1">
                    <Phone className="h-3.5 w-3.5" />
                    {sub.phone}
                  </span>
                )}
                {sub.email && (
                  <span className="flex items-center gap-1">
                    <Mail className="h-3.5 w-3.5" />
                    {sub.email}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
