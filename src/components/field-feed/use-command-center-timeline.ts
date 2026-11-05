"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getCommandCenterUpdatesPage } from "@/lib/actions/command-center-updates";
import type { CommandCenterUpdate, CommandCenterUpdatesPage } from "@/lib/feed/command-center-updates";
import { appendTimeline, initialTimeline, refreshTimeline, removeTimelineItem, timelineHasMore, type UpdatesRange } from "./command-center-timeline-state";

export function useCommandCenterTimeline(initialUpdates: CommandCenterUpdatesPage | null, range: UpdatesRange) {
  const [state, setState] = useState(() => initialTimeline(initialUpdates));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialUpdates === null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const latest = useRef({ state, range });
  latest.current = { state, range };

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!initialUpdates) return;
    setState((current) => refreshTimeline(current, initialUpdates));
    setError(false);
  }, [initialUpdates]);

  const loadMore = useCallback(async () => {
    const current = latest.current;
    if (inFlight.current || !timelineHasMore(current.state, current.range)) return;
    inFlight.current = true;
    setLoading(true);
    setError(false);
    const cursor = current.state.initialized ? current.state.nextCursor : null;
    try {
      const page = await getCommandCenterUpdatesPage(cursor);
      if (mounted.current) setState((value) => appendTimeline(value, page, cursor, current.state.cursorVersion));
    } catch {
      if (mounted.current) setError(true);
    } finally {
      inFlight.current = false;
      if (mounted.current) setLoading(false);
    }
  }, []);

  const remove = useCallback((item: CommandCenterUpdate) => setState((current) => removeTimelineItem(current, item)), []);
  return { items: state.items, deletedKeys: state.deletedKeys, remove, hasMore: timelineHasMore(state, range), loading, error, loadMore };
}
