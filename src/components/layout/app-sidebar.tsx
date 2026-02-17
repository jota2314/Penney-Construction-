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
      <SidebarHeader>
        <div className="flex items-center gap-2.5 px-2 py-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.jpg"
            alt="Penney Construction"
            className="h-8 w-8 shrink-0 rounded-md object-contain bg-white"
          />
          <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate font-semibold">Penney Construction</span>
            <span className="truncate text-xs text-sidebar-foreground/60">
              Pre-Con Platform
            </span>
          </div>
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
