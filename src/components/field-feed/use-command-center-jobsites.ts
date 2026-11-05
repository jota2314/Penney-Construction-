"use client";

import { useCallback, useEffect, useState } from "react";
import { getCommandCenterJobsites } from "@/lib/actions/command-center-jobsites";
import type { Jobsite } from "@/components/field-feed/command-center-feed";

/** Fetch the desktop-only rail after the feed is usable; mobile never needs it. */
export function useCommandCenterJobsites(enabled: boolean, refreshKey: unknown) {
  const [result, setResult] = useState<{
    jobsites: Jobsite[];
    error: string | null;
    refreshKey: unknown;
    retryVersion: number;
  } | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);
  const retry = useCallback(() => setRetryVersion((version) => version + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    getCommandCenterJobsites().then((sites) => {
      if (cancelled) return;
      setResult({ jobsites: sites, error: null, refreshKey, retryVersion });
    }).catch(() => {
      if (!cancelled) setResult((previous) => ({
        jobsites: previous?.jobsites ?? [],
        error: "Jobsites could not load.",
        refreshKey,
        retryVersion,
      }));
    });
    // Ignore results for an older refresh or after the viewport leaves desktop.
    return () => { cancelled = true; };
  }, [enabled, refreshKey, retryVersion]);

  const current = result?.refreshKey === refreshKey && result?.retryVersion === retryVersion;
  return {
    jobsites: result?.jobsites ?? [],
    loading: enabled && !current,
    error: current ? result?.error ?? null : null,
    retry,
  };
}
