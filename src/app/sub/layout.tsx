import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Sub Portal · Penney Construction",
  description: "Your schedule, awarded work, billing, drawings and daily log with Penney Construction.",
  robots: { index: false, follow: false },
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
