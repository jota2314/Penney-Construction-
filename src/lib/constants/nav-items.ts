import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  FolderKanban,
  Users,
  Calculator,
  Camera,
  HardHat,
  Settings,
  Workflow,
  FileText,
  Send,
  Store,
  UserCog,
  CalendarDays,
} from "lucide-react";
import type { AppMode } from "@/types/auth";

export interface NavItem {
  title: string;
  url: string;
  icon: LucideIcon;
  comingSoon?: boolean;
  modes?: AppMode[];
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
  modes?: AppMode[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
    ],
  },
  {
    label: "Pre-Construction",
    modes: ["precon"],
    items: [
      { title: "CRM", url: "/crm", icon: Workflow },
      { title: "Estimates", url: "/estimates", icon: Calculator },
      {
        title: "Bid Requests",
        url: "/bid-requests",
        icon: Send,
        comingSoon: true,
      },
      {
        title: "Proposals",
        url: "/proposals",
        icon: FileText,
        comingSoon: true,
      },
    ],
  },
  {
    label: "Construction",
    modes: ["construction"],
    items: [
      { title: "Projects", url: "/projects", icon: FolderKanban },
      { title: "Schedule", url: "/schedule", icon: CalendarDays },
      { title: "Employees", url: "/employees", icon: UserCog },
      {
        title: "Vendors",
        url: "/vendors",
        icon: Store,
        comingSoon: true,
      },
    ],
  },
  {
    label: null,
    items: [
      { title: "Subcontractors", url: "/subcontractors", icon: HardHat },
      { title: "Site Visits", url: "/site-visits", icon: Camera },
      { title: "Customers", url: "/customers", icon: Users },
      { title: "Settings", url: "/settings", icon: Settings },
    ],
  },
];

export function filterNavByMode(
  groups: NavGroup[],
  mode: AppMode
): NavGroup[] {

  return groups
    .filter((group) => !group.modes || group.modes.includes(mode))
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) => !item.modes || item.modes.includes(mode)
      ),
    }))
    .filter((group) => group.items.length > 0);
}
