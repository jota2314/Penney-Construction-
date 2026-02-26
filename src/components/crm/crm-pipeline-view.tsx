"use client";

import Link from "next/link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { LeadStatusBadge } from "@/components/leads/lead-status-badge";
import { MeetingStatusBadge } from "@/components/meetings/meeting-status-badge";
import { EstimateStatusBadge } from "@/components/estimates/estimate-status-badge";
import type { Lead, Meeting, Estimate } from "@/types/database";

interface EstimateWithLead extends Estimate {
  lead?: Pick<Lead, "first_name" | "last_name" | "lead_number"> | null;
}

interface CrmPipelineViewProps {
  leads: Lead[];
  meetings: (Meeting & { lead?: Pick<Lead, "first_name" | "last_name"> | null })[];
  recentEstimates: EstimateWithLead[];
}

const formatCurrency = (val: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(val);

export function CrmPipelineView({
  leads,
  meetings,
  recentEstimates,
}: CrmPipelineViewProps) {
  return (
    <Tabs defaultValue="leads">
      <TabsList className="w-full grid grid-cols-3">
        <TabsTrigger value="leads" className="text-xs sm:text-sm">Leads ({leads.length})</TabsTrigger>
        <TabsTrigger value="meetings" className="text-xs sm:text-sm">
          Meetings ({meetings.length})
        </TabsTrigger>
        <TabsTrigger value="estimates" className="text-xs sm:text-sm">
          Estimates ({recentEstimates.length})
        </TabsTrigger>
      </TabsList>

      <TabsContent value="leads" className="mt-4 space-y-2">
        {leads.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-8">
            No active leads.
          </p>
        ) : (
          leads.map((lead) => (
            <Link key={lead.id} href={`/crm/leads/${lead.id}`}>
              <Card className="hover:bg-accent transition-colors cursor-pointer">
                <CardContent className="py-3 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">
                      {lead.first_name} {lead.last_name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {lead.lead_number}
                      {lead.description &&
                        ` — ${lead.description.substring(0, 50)}${lead.description.length > 50 ? "..." : ""}`}
                    </p>
                  </div>
                  <LeadStatusBadge status={lead.status} />
                </CardContent>
              </Card>
            </Link>
          ))
        )}
      </TabsContent>

      <TabsContent value="meetings" className="mt-4 space-y-2">
        {meetings.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-8">
            No upcoming meetings.
          </p>
        ) : (
          meetings.map((meeting) => (
            <Link key={meeting.id} href={`/crm/meetings/${meeting.id}`}>
              <Card className="hover:bg-accent transition-colors cursor-pointer">
                <CardContent className="py-3 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">
                      {meeting.lead
                        ? `${meeting.lead.first_name} ${meeting.lead.last_name}`
                        : "Unknown"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(meeting.scheduled_at).toLocaleDateString(
                        "en-US",
                        {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                        }
                      )}{" "}
                      at{" "}
                      {new Date(meeting.scheduled_at).toLocaleTimeString(
                        "en-US",
                        { hour: "numeric", minute: "2-digit" }
                      )}
                      {meeting.address && ` — ${meeting.address}`}
                    </p>
                  </div>
                  <MeetingStatusBadge status={meeting.status} />
                </CardContent>
              </Card>
            </Link>
          ))
        )}
      </TabsContent>

      <TabsContent value="estimates" className="mt-4 space-y-2">
        {recentEstimates.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-8">
            No active estimates.
          </p>
        ) : (
          recentEstimates.map((est) => (
            <Link key={est.id} href={`/estimates/${est.id}`}>
              <Card className="hover:bg-accent transition-colors cursor-pointer">
                <CardContent className="py-3 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">{est.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {est.lead
                        ? `${est.lead.lead_number} — ${est.lead.first_name} ${est.lead.last_name}`
                        : "Estimate"}
                      {est.total_price > 0 && ` — ${formatCurrency(est.total_price)}`}
                    </p>
                  </div>
                  <EstimateStatusBadge status={est.status} />
                </CardContent>
              </Card>
            </Link>
          ))
        )}
      </TabsContent>
    </Tabs>
  );
}
