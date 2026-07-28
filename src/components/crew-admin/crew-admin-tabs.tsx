"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Radio, Users, DollarSign, UserPlus } from "lucide-react";
import { ActiveNowView } from "./active-now-view";
import { CrewRosterView } from "./crew-roster-view";
import { InviteFieldWorker } from "./invite-field-worker";
import { PayrollTimesheet } from "./payroll-timesheet";

/* eslint-disable @typescript-eslint/no-explicit-any */
export function CrewAdminTabs({
  data,
  canViewPayroll = false,
  canEditRates = false,
}: {
  data: any;
  canViewPayroll?: boolean;
  canEditRates?: boolean;
}) {
  const [activeTab, setActiveTab] = useState("active");
  const activeCount = data.activeEntries.length;

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      {/*
        Scrolling strip rather than grid-cols-N: on a phone four fixed columns
        squeezed the labels until they spilled out of the pill. Triggers keep
        their natural width and the row scrolls if it needs to.
      */}
      <TabsList className="w-full justify-start gap-1 overflow-x-auto no-scrollbar h-auto p-1">
        <CrewTab value="active" icon={<Radio className="h-3.5 w-3.5" />} label="Active">
          {activeCount > 0 && (
            <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-green-500/20 px-1 text-[10px] font-semibold text-green-500">
              {activeCount}
            </span>
          )}
        </CrewTab>
        <CrewTab value="roster" icon={<Users className="h-3.5 w-3.5" />} label="Roster" />
        {canViewPayroll && (
          <CrewTab
            value="payroll"
            icon={<DollarSign className="h-3.5 w-3.5" />}
            label="Payroll"
          />
        )}
        <CrewTab value="invite" icon={<UserPlus className="h-3.5 w-3.5" />} label="Invite" />
      </TabsList>

      <TabsContent value="active" className="mt-4">
        <ActiveNowView
          activeEntries={data.activeEntries}
          todayEntries={data.todayEntries}
        />
      </TabsContent>

      <TabsContent value="roster" className="mt-4">
        <CrewRosterView
          employees={data.employees}
          assignments={data.assignments}
          allowedEmails={data.allowedEmails}
          activeProjects={data.activeProjects}
          canEditRates={canEditRates}
        />
      </TabsContent>

      {canViewPayroll && (
        <TabsContent value="payroll" className="mt-4">
          <PayrollTimesheet canEditRates={canEditRates} />
        </TabsContent>
      )}

      <TabsContent value="invite" className="mt-4">
        <InviteFieldWorker />
      </TabsContent>
    </Tabs>
  );
}

function CrewTab({
  value,
  icon,
  label,
  children,
}: {
  value: string;
  icon: React.ReactNode;
  label: string;
  children?: React.ReactNode;
}) {
  return (
    <TabsTrigger value={value} className="flex-none px-3 py-1.5">
      {icon}
      <span>{label}</span>
      {children}
    </TabsTrigger>
  );
}
