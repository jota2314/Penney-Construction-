import {
  LayoutDashboard,
  FolderKanban,
  Users,
  Calculator,
  HardHat,
  Settings,
} from "lucide-react";

export const NAV_ITEMS = [
  {
    title: "Dashboard",
    url: "/dashboard",
    icon: LayoutDashboard,
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
