import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Survey · Penney Construction",
  description: "A short survey from Penney Construction.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
};

export default function SurveyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
