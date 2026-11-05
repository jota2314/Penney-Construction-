import type { CommandCenterUpdate, CommandCenterUpdatesPage } from "@/lib/feed/command-center-updates";

export type UpdatesRange = "all" | "day" | "week";

export function updateKey(item: CommandCenterUpdate): string {
  if (item.type === "companyPost") return `company-${item.post.id}`;
  if (item.type === "logPost") return `log-${item.log.id}`;
  return `punch-${item.group.session_id}`;
}

export function updateTimestamp(item: CommandCenterUpdate): number {
  return new Date(item.type === "companyPost" ? item.post.createdAt : item.type === "logPost" ? item.log.started_at : item.group.created_at).getTime();
}

function sortValue(item: CommandCenterUpdate): string {
  const timestamp = item.type === "companyPost" ? item.post.createdAt : item.type === "logPost" ? item.log.started_at : item.group.created_at;
  // Keep PostgreSQL's microseconds when available, instead of collapsing
  // simultaneous entries to JavaScript's millisecond precision.
  const fraction = timestamp.match(/\.(\d+)/)?.[1] ?? "";
  const utc = new Date(timestamp).toISOString().slice(0, 19);
  const source = item.type === "companyPost" ? "company_post" : item.type === "logPost" ? "daily_log" : "punch_group";
  const id = item.type === "companyPost" ? item.post.id : item.type === "logPost" ? item.log.id : item.group.session_id;
  return `${utc}.${fraction.padEnd(6, "0").slice(0, 6)}:${source}:${id}`;
}

function chronological(items: CommandCenterUpdate[]): CommandCenterUpdate[] {
  return items.sort((a, b) => sortValue(a) > sortValue(b) ? -1 : sortValue(a) < sortValue(b) ? 1 : 0);
}

export function rangeCutoff(range: UpdatesRange, now = new Date()): number {
  if (range === "all") return -Infinity;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - (range === "week" ? 6 : 0)).getTime();
}

export type TimelineState = {
  items: CommandCenterUpdate[];
  nextCursor: string | null;
  initialized: boolean;
  paginated: boolean;
  headKeys: Set<string>;
  headBoundary: string;
  exhaustive: boolean;
  cursorVersion: number;
  frontierTimestamp: number;
  deletedKeys: Set<string>;
};

export function initialTimeline(page: CommandCenterUpdatesPage | null): TimelineState {
  return {
    items: page?.items ?? [], nextCursor: page?.nextCursor ?? null,
    initialized: page !== null, paginated: false,
    headKeys: new Set(page?.items.map(updateKey)),
    headBoundary: page?.items.length ? page.items.map(sortValue).sort()[0] : "",
    exhaustive: page !== null && page.nextCursor === null,
    cursorVersion: 0,
    frontierTimestamp: page?.items.length ? Math.min(...page.items.map(updateTimestamp)) : Infinity,
    deletedKeys: new Set(),
  };
}

/** The refreshed first page is authoritative only over its own date window.
 * Keep previously loaded history, including posts displaced by newer posts. */
export function refreshTimeline(state: TimelineState, page: CommandCenterUpdatesPage | null): TimelineState {
  if (!page) return state;
  const fresh = initialTimeline(page);
  const disjoint = state.initialized && state.items.length > 0 && !fresh.exhaustive &&
    !state.items.some((item) => fresh.headKeys.has(updateKey(item)));
  const older = fresh.exhaustive ? [] : state.items.filter((item) =>
    // Match the server's exact timestamp/source/id tuple, including ties.
    !state.deletedKeys.has(updateKey(item)) && !fresh.headKeys.has(updateKey(item)) && sortValue(item) < fresh.headBoundary,
  );
  return {
    ...fresh,
    items: chronological([...page.items.filter((item) => !state.deletedKeys.has(updateKey(item))), ...older]),
    deletedKeys: state.deletedKeys,
    paginated: disjoint ? false : state.paginated,
    cursorVersion: state.cursorVersion + (disjoint ? 1 : 0),
    frontierTimestamp: state.paginated && !disjoint ? state.frontierTimestamp : fresh.frontierTimestamp,
    // If more than a full page arrived, walk from the fresh head again to fill
    // the gap. Cached older cards remain visible and will be de-duplicated.
    nextCursor: fresh.exhaustive ? null : disjoint ? page.nextCursor : state.paginated ? state.nextCursor : page.nextCursor,
  };
}

/** Do not let a slow older-page response overwrite refreshed posts or revive
 * a post deleted from the authoritative first page while it was in flight. */
export function appendTimeline(state: TimelineState, page: CommandCenterUpdatesPage, requestedCursor: string | null, cursorVersion = state.cursorVersion): TimelineState {
  if (cursorVersion !== state.cursorVersion) return state;
  if (requestedCursor === null) return state.initialized ? state : refreshTimeline(state, page);
  if (state.exhaustive) return state;
  const known = new Set(state.items.map(updateKey));
  const additions = page.items.filter((item) => {
    const key = updateKey(item);
    if (known.has(key) || state.deletedKeys.has(key)) return false;
    if (sortValue(item) >= state.headBoundary && !state.headKeys.has(key)) return false;
    known.add(key);
    return true;
  });
  return { ...state, items: chronological([...state.items, ...additions]), nextCursor: page.nextCursor, paginated: true,
    frontierTimestamp: page.items.length ? Math.min(...page.items.map(updateTimestamp)) : state.frontierTimestamp };
}

export function removeTimelineItem(state: TimelineState, item: CommandCenterUpdate): TimelineState {
  const key = updateKey(item);
  return { ...state, items: state.items.filter((entry) => updateKey(entry) !== key), deletedKeys: new Set([...state.deletedKeys, key]) };
}

/** Stop at the selected date boundary instead of fetching hidden history. */
export function timelineHasMore(state: TimelineState, range: UpdatesRange): boolean {
  if (!state.initialized) return true;
  if (!state.nextCursor) return false;
  return state.frontierTimestamp >= rangeCutoff(range);
}
