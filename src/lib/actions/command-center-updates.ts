"use server";

import { createClient } from "@/lib/supabase/server";
import { listRecentDailyLogs, listPunchGroupsByKeys } from "@/lib/actions/daily-logs";
import { listRecentCompanyFeedPosts } from "@/lib/actions/company-feed";
import { COMMAND_CENTER_PAGE_SIZE, type CommandCenterUpdate, type CommandCenterUpdatesPage } from "@/lib/feed/command-center-updates";
import { decodeUpdateCursor, encodeUpdateCursor, isUpdateId, isUpdateKey, type UpdateKey } from "@/lib/feed/update-cursor";

async function hydrateKeys(keys: UpdateKey[]): Promise<CommandCenterUpdate[]> {
  const idsFor = (source: UpdateKey["source"]) => keys.filter(key => key.source === source).map(key => key.source_id);
  const [logs, posts, groups] = await Promise.all([
    listRecentDailyLogs(COMMAND_CENTER_PAGE_SIZE, undefined, { ids: idsFor("daily_log"), signPhotos: false, throwOnError: true }),
    listRecentCompanyFeedPosts(COMMAND_CENTER_PAGE_SIZE, { ids: idsFor("company_post"), signPhotos: false, throwOnError: true }),
    listPunchGroupsByKeys(idsFor("punch_group")),
  ]);
  const items = new Map<string, CommandCenterUpdate>([
    ...logs.map(log => [`daily_log:${log.id}`, { type: "logPost", log }] as [string, CommandCenterUpdate]),
    ...posts.map(post => [`company_post:${post.id}`, { type: "companyPost", post }] as [string, CommandCenterUpdate]),
    ...groups.map(group => [`punch_group:${group.session_id}`, { type: "punchGroupPost", group }] as [string, CommandCenterUpdate]),
  ]);
  return keys.flatMap(key => {
    const item = items.get(`${key.source}:${key.source_id}`);
    // A deletion between key selection and hydration is harmless. Retain the
    // database cursor so the next request continues past the deleted record.
    if (!item) return [];
    if (item.type === "punchGroupPost") item.group.created_at = key.occurred_at;
    return [item];
  });
}

export async function getCommandCenterUpdatesPage(cursor: string | null = null): Promise<CommandCenterUpdatesPage> {
  const before = decodeUpdateCursor(cursor);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("command_center_update_keys", {
    p_before_at: before?.occurred_at ?? null,
    p_before_source: before?.source ?? null,
    p_before_id: before?.source_id ?? null,
    p_limit: COMMAND_CENTER_PAGE_SIZE + 1,
  });
  if (error) throw new Error("Updates could not load. Please try again.");
  if (!Array.isArray(data) || data.some(key => !isUpdateKey(key))) {
    throw new Error("Updates could not load. Please try again.");
  }
  const keys = (data as UpdateKey[]).slice(0, COMMAND_CENTER_PAGE_SIZE);
  const items = await hydrateKeys(keys);
  return {
    items,
    nextCursor: data.length > COMMAND_CENTER_PAGE_SIZE ? encodeUpdateCursor(keys[keys.length - 1]) : null,
  };
}

/** Notification links can open an old post directly without paging its history. */
export async function getCommandCenterFocusedUpdate(id: string): Promise<CommandCenterUpdate | null> {
  if (typeof id !== "string" || !isUpdateId(id.startsWith("solo-") ? id.slice(5) : id)) return null;
  const uuid = !id.startsWith("solo-");
  const [logs, posts, groups] = await Promise.all([
    uuid ? listRecentDailyLogs(1, undefined, { ids: [id], signPhotos: false, throwOnError: true }) : Promise.resolve([]),
    uuid ? listRecentCompanyFeedPosts(1, { ids: [id], signPhotos: false, throwOnError: true }) : Promise.resolve([]),
    listPunchGroupsByKeys([id]),
  ]);
  if (logs[0]) return { type: "logPost", log: logs[0] };
  if (posts[0]) return { type: "companyPost", post: posts[0] };
  if (groups[0]) return { type: "punchGroupPost", group: groups[0] };
  return null;
}
