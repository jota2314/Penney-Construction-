import type { LucideIcon } from "lucide-react";
import {
  Radar,
  Settings,
} from "lucide-react";

export interface NavItem {
  title: string;
  url: string;
  icon: LucideIcon;
  comingSoon?: boolean;
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

/**
 * Simplified navigation — Command Center is the hub for everything.
 * All project, estimate, schedule, sub, and customer data is accessible
 * from within the Command Center's project workspace.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { title: "Command Center", url: "/command-center", icon: Radar },
      { title: "Settings", url: "/settings", icon: Settings },
    ],
  },
];
