"use client";

import { useSearchParams, usePathname } from "next/navigation";
import { useCallback } from "react";

interface Options {
  /**
   * "replace" (default) swaps the current history entry — good for filters
   * where back should skip intermediate states.
   * "push" adds a history entry per change — good for tab navigation where
   * the browser/phone back gesture should return to the previous tab.
   */
  history?: "replace" | "push";
}

/**
 * Like useState, but persists to URL search params so state survives navigation.
 * Usage: const [tab, setTab] = useSearchParamState("tab", "overview");
 */
export function useSearchParamState(
  key: string,
  defaultValue: string,
  { history = "replace" }: Options = {}
): [string, (value: string) => void] {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const value = searchParams.get(key) ?? defaultValue;

  const setValue = useCallback(
    (newValue: string) => {
      // No-op on the current value — in push mode a duplicate entry would
      // make the back gesture appear to do nothing.
      if (newValue === (searchParams.get(key) ?? defaultValue)) return;
      const params = new URLSearchParams(searchParams.toString());
      if (newValue === defaultValue) {
        params.delete(key);
      } else {
        params.set(key, newValue);
      }
      const qs = params.toString();
      const url = `${pathname}${qs ? `?${qs}` : ""}`;
      // Shallow update via the History API — `router.replace/push` re-runs
      // the whole server component (every query on the page) just to flip a
      // client-side filter. No server page reads these params, so skip the
      // round trip; Next keeps `useSearchParams()` in sync with pushState/
      // replaceState natively.
      if (history === "push") {
        window.history.pushState(null, "", url);
      } else {
        window.history.replaceState(null, "", url);
      }
    },
    [key, defaultValue, history, pathname, searchParams]
  );

  return [value, setValue];
}
