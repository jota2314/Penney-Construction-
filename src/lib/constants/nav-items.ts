import type { LucideIcon } from "lucide-react";
import {
  FolderKanban,
  Users,
  Calculator,
  Camera,
  HardHat,
  Settings,
  FileText,
  Send,
  UserCog,
  CalendarDays,
  BookOpen,
  Footprints,
  Workflow,
  Radar,
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

export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { title: "Command Center", url: "/command-center", icon: Radar },
      { title: "Workflow", url: "/workflow", icon: Workflow },
    ],
  },
  {
    label: "Projects",
    items: [
      { title: "CRM", url: "/projects", icon: FolderKanban },
      { title: "Active Projects", url: "/active-projects", icon: FolderKanban },
      { title: "Estimates", url: "/estimates", icon: Calculator },
      { title: "Cost Book", url: "/cost-book", icon: BookOpen },
      { title: "Schedule", url: "/schedule", icon: CalendarDays },
      { title: "Bid Requests", url: "/bid-requests", icon: Send, comingSoon: true },
      { title: "Proposals", url: "/proposals", icon: FileText, comingSoon: true },
    ],
  },
  {
    label: "People",
    items: [
      { title: "Subcontractors", url: "/subcontractors", icon: HardHat },
      { title: "Customers", url: "/customers", icon: Users },
      { title: "Employees", url: "/employees", icon: UserCog },
    ],
  },
  {
    label: null,
    items: [
      { title: "Walkthroughs", url: "/walkthroughs", icon: Footprints },
      { title: "Site Visits", url: "/site-visits", icon: Camera },
      { title: "Settings", url: "/settings", icon: Settings },
    ],
  },
];
