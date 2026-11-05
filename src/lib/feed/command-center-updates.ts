import type { CompanyFeedPost } from "@/lib/actions/company-feed";
import type { FeedDailyLog, FeedPunchGroup } from "@/lib/actions/daily-logs";

export type CommandCenterUpdate =
  | { type: "logPost"; log: FeedDailyLog }
  | { type: "companyPost"; post: CompanyFeedPost }
  | { type: "punchGroupPost"; group: FeedPunchGroup };

export type CommandCenterUpdatesPage = {
  items: CommandCenterUpdate[];
  nextCursor: string | null;
};

export const COMMAND_CENTER_PAGE_SIZE = 20;
