import type { LucideIcon } from "lucide-react";
import {
  Radar,
  LayoutDashboard,
  FolderKanban,
  Calculator,
  Users,
  UserCircle,
  HardHat,
  Mail,
  Receipt,
  Settings,
  ClipboardCheck,
  Warehouse,
  Clock,
  Bot,
  Mic,
  UserPlus,
  Compass,
  Bath,
  Table2,
  Wallet,
  BookOpen,
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
      { title: "My time / Clock in", url: "/command-center/my-time", icon: Clock },
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
      // The one finance destination — Overview / Expenses / Income / Weekly
      // Close as tabs. canAccessPath("/finances") hides it from field crew.
      { title: "Finances", url: "/finances", icon: Wallet },
      // The one schedule since 10/5 — /schedule redirects here.
      // Office-wide since 8/22; canAccessPath("/board") still hides it from field crew.
      { title: "Job Board", url: "/board", icon: Table2 },
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
      // Todos moved off the sidebar — /command-center/todos still works, and
      // the Command Center's "Needs attention" card links straight to it.
      // Weekly Close moved into Finances (a FinanceTabs tab on /week).
      { title: "Invoices", url: "/invoices", icon: Receipt },
      // Jorge-only sandbox; canAccessPath("/design") hides it from everyone else.
      { title: "Design Studio", url: "/design", icon: Bath },
      { title: "Product Catalog", url: "/design/catalog", icon: Bath },
      // Office + PMs (Ryan's 9/27 ask). Field crew never see it: middleware
      // sends role `field` to /crew.
      { title: "How-To Guides", url: "/guides", icon: BookOpen },
    ],
  },
  {
    label: null,
    items: [
      { title: "Settings", url: "/settings", icon: Settings },
    ],
  },
];
