import type { LucideIcon } from "lucide-react";
import {
  Radar,
  LayoutDashboard,
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
  ClipboardCheck,
  Clock,
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
      { title: "CEO Dashboard", url: "/ceo", icon: LayoutDashboard },
    ],
  },
  {
    label: "Core",
    items: [
      { title: "Projects", url: "/projects", icon: FolderKanban },
      { title: "Estimates", url: "/estimates", icon: Calculator },
      { title: "Quotes", url: "/command-center/quotes", icon: FileCheck },
      { title: "Schedule", url: "/schedule", icon: CalendarDays },
      { title: "Walkthroughs", url: "/walkthroughs", icon: ClipboardCheck },
    ],
  },
  {
    label: "People",
    items: [
      { title: "Customers", url: "/customers", icon: Users },
      { title: "Subcontractors", url: "/subcontractors", icon: HardHat },
      { title: "Crew", url: "/crew-admin", icon: Clock },
    ],
  },
  {
    label: "Tools",
    items: [
      { title: "Email", url: "/command-center/emails", icon: Mail },
      { title: "Todos", url: "/command-center/todos", icon: Bell },
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
