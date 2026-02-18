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
import { NAV_ITEMS } from "@/lib/constants/nav-items";
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
        {/* Big logo — visible when sidebar is expanded */}
        <div className="group-data-[collapsible=icon]:hidden flex flex-col items-center px-3 pt-4 pb-3 border-b border-sidebar-border">
          <div className="rounded-lg px-4 py-3 w-full flex items-center justify-center bg-white dark:bg-white/10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.jpg"
              alt="Penney Construction"
              className="w-full h-auto max-h-32"
            />
          </div>
        </div>
        {/* Small icon — visible when sidebar is collapsed */}
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
        <NavMain items={NAV_ITEMS} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser profile={profile} email={email} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
