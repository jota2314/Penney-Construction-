"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActiveNowView } from "./active-now-view";
import { CrewRosterView } from "./crew-roster-view";
import { InviteFieldWorker } from "./invite-field-worker";
import { PayrollTimesheet } from "./payroll-timesheet";

/* eslint-disable @typescript-eslint/no-explicit-any */
export function CrewAdminTabs({
  data,
  canViewPayroll = false,
}: {
  data: any;
  canViewPayroll?: boolean;
}) {
  const [activeTab, setActiveTab] = useState("active");

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      <TabsList className={`w-full grid ${canViewPayroll ? "grid-cols-4" : "grid-cols-3"}`}>
        <TabsTrigger value="active">
          Active Now ({data.activeEntries.length})
        </TabsTrigger>
        <TabsTrigger value="roster">Crew Roster</TabsTrigger>
        {canViewPayroll && <TabsTrigger value="payroll">Payroll</TabsTrigger>}
        <TabsTrigger value="invite">Invite</TabsTrigger>
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
        />
      </TabsContent>

      {canViewPayroll && (
        <TabsContent value="payroll" className="mt-4">
          <PayrollTimesheet />
        </TabsContent>
      )}

      <TabsContent value="invite" className="mt-4">
        <InviteFieldWorker />
      </TabsContent>
    </Tabs>
  );
}
