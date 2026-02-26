import {
  LayoutDashboard,
  FolderKanban,
  Users,
  Calculator,
  Camera,
  HardHat,
  Settings,
  Workflow,
} from "lucide-react";

export const NAV_ITEMS = [
  {
    title: "Dashboard",
    url: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    title: "CRM",
    url: "/crm",
    icon: Workflow,
  },
  {
    title: "Projects",
    url: "/projects",
    icon: FolderKanban,
  },
  {
    title: "Customers",
    url: "/customers",
    icon: Users,
  },
  {
    title: "Estimates",
    url: "/estimates",
    icon: Calculator,
  },
  {
    title: "Site Visits",
    url: "/site-visits",
    icon: Camera,
  },
  {
    title: "Subcontractors",
    url: "/subcontractors",
    icon: HardHat,
  },
  {
    title: "Settings",
    url: "/settings",
    icon: Settings,
  },
];
