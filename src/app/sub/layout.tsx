import type { Metadata, Viewport } from "next";
import { APPLE_STARTUP_IMAGES } from "@/lib/pwa";

export const metadata: Metadata = {
  title: "Sub Portal · Penney Construction",
  description: "Your schedule, awarded work, billing, drawings and daily log with Penney Construction.",
  robots: { index: false, follow: false },
  // Subs install the portal from /sub. Without its own manifest they inherit
  // the team app's, whose start_url is /command-center — so the Home Screen
  // icon opened the team app and asked them for a Google login.
  manifest: "/sub-manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black",
    title: "Penney Sub",
    startupImage: APPLE_STARTUP_IMAGES,
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0a08",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function SubLayout({ children }: { children: React.ReactNode }) {
  return children;
}
