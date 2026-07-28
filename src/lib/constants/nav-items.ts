import type { LucideIcon } from "lucide-react";
import {
  Radar,
  LayoutDashboard,
  FolderKanban,
  Calculator,
  CalendarDays,
  Users,
  UserCircle,
  HardHat,
  Mail,
  Bell,
  Settings,
  ClipboardCheck,
  Warehouse,
  Clock,
  FileCheck,
  Bot,
  Mic,
  UserPlus,
  Compass,
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
      { title: "Agent Crew", url: "/command-center/agents", icon: Bot },
      { title: "CEO Dashboard", url: "/ceo", icon: LayoutDashboard },
    ],
  },
  {
    label: "Core",
    items: [
      { title: "EOS", url: "/eos", icon: Compass },
      { title: "Projects", url: "/projects", icon: FolderKanban },
      { title: "Estimating", url: "/estimates", icon: Calculator },
      { title: "Reviews", url: "/command-center/reviews", icon: FileCheck },
      { title: "Schedule", url: "/schedule", icon: CalendarDays },
      { title: "Meetings", url: "/meetings", icon: Mic },
      { title: "Walkthroughs", url: "/walkthroughs", icon: ClipboardCheck },
      { title: "Warehouse", url: "/warehouse", icon: Warehouse },
    ],
  },
  {
    label: "People",
    items: [
      { title: "Team", url: "/team", icon: UserCircle },
      { title: "Customers", url: "/customers", icon: Users },
      { title: "Subcontractors", url: "/subcontractors", icon: HardHat },
      { title: "Crew", url: "/crew-admin", icon: Clock },
      { title: "Hiring", url: "/hiring", icon: UserPlus },
    ],
  },
  {
    label: "Tools",
    items: [
      { title: "Email", url: "/command-center/emails", icon: Mail },
      { title: "Todos", url: "/command-center/todos", icon: Bell },
    ],
  },
  {
    label: null,
    items: [
      { title: "Settings", url: "/settings", icon: Settings },
    ],
  },
];
