import type { LucideIcon } from "lucide-react";
import {
  Radar,
  FolderKanban,
  Calculator,
  FileCheck,
  CalendarDays,
  Users,
  HardHat,
  Mail,
  Bell,
  BookOpen,
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

export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { title: "Command Center", url: "/command-center", icon: Radar },
    ],
  },
  {
    label: "Core",
    items: [
      { title: "Projects", url: "/projects", icon: FolderKanban },
      { title: "Estimates", url: "/estimates", icon: Calculator },
      { title: "Quotes", url: "/command-center/quotes", icon: FileCheck },
      { title: "Schedule", url: "/schedule", icon: CalendarDays },
    ],
  },
  {
    label: "People",
    items: [
      { title: "Customers", url: "/customers", icon: Users },
      { title: "Subcontractors", url: "/subcontractors", icon: HardHat },
    ],
  },
  {
    label: "Tools",
    items: [
      { title: "Email", url: "/command-center/emails", icon: Mail },
      { title: "Follow-ups", url: "/command-center/follow-ups", icon: Bell },
      { title: "Cost Book", url: "/cost-book", icon: BookOpen },
    ],
  },
  {
    label: null,
    items: [
      { title: "Settings", url: "/settings", icon: Settings },
    ],
  },
];
