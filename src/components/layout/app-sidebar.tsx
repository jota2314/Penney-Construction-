"use client";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar";
import { NavMain } from "./nav-main";
import { NavUser } from "./nav-user";
import { NAV_GROUPS } from "@/lib/constants/nav-items";
import type { UserProfile } from "@/types/auth";

export function AppSidebar({
  profile,
  email,
}: {
  profile: UserProfile | null;
  email: string;
}) {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-0">
        {/* Expanded logo */}
        <div className="group-data-[collapsible=icon]:hidden flex flex-col items-center px-3 pt-4 pb-2">
          <div className="rounded-lg px-4 py-3 w-full flex items-center justify-center bg-white dark:bg-white/10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.jpg"
              alt="Penney Construction"
              className="w-full h-auto max-h-36"
            />
          </div>
        </div>
        {/* Collapsed icon */}
        <div className="hidden group-data-[collapsible=icon]:flex items-center justify-center py-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.jpg"
            alt="PC"
            className="h-8 w-8 rounded-md object-contain bg-white dark:bg-white/10"
          />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <NavMain groups={NAV_GROUPS} />
      </SidebarContent>

      <SidebarFooter>
        <NavUser profile={profile} email={email} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
