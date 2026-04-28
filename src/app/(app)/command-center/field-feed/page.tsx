import type { Metadata } from "next";
import { CommandCenterFeed } from "@/components/field-feed/command-center-feed";

export const metadata: Metadata = { title: "Command Center | Penney Construction" };

export default function FieldFeedPage() {
  return <CommandCenterFeed />;
}
