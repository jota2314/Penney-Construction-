"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
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
  const router = useRouter();
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
      if (history === "push") {
        router.push(url, { scroll: false });
      } else {
        router.replace(url, { scroll: false });
      }
    },
    [key, defaultValue, history, router, pathname, searchParams]
  );

  return [value, setValue];
}
