import type { Metadata } from "next";
import { LiveFieldFeed } from "@/components/field-feed/live-field-feed";

export const metadata: Metadata = { title: "Live Field Feed | Penney Construction" };

export default function FieldFeedPage() {
  return <LiveFieldFeed />;
}
