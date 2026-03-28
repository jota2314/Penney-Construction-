import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  FolderKanban,
  Users,
  Calculator,
  Camera,
  HardHat,
  Settings,
  FileText,
  Send,
  Store,
  UserCog,
  CalendarDays,
  BookOpen,
  Footprints,
  Workflow,
  Radar,
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
      { title: "Command Center", url: "/command-center", icon: Radar },
      { title: "Workflow", url: "/workflow", icon: Workflow },
    ],
  },
  {
    label: "Pre-Construction",
    modes: ["precon"],
    items: [
      { title: "CRM", url: "/projects", icon: FolderKanban },
      { title: "Estimates", url: "/estimates", icon: Calculator },
      { title: "Cost Book", url: "/cost-book", icon: BookOpen },
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
      { title: "Projects", url: "/active-projects", icon: FolderKanban },
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
      { title: "Walkthroughs", url: "/walkthroughs", icon: Footprints, modes: ["precon"] },
      { title: "Site Visits", url: "/site-visits", icon: Camera, modes: ["construction"] },
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
