"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback } from "react";

/**
 * Like useState, but persists to URL search params so state survives navigation.
 * Usage: const [tab, setTab] = useSearchParamState("tab", "overview");
 */
export function useSearchParamState(
  key: string,
  defaultValue: string
): [string, (value: string) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const value = searchParams.get(key) ?? defaultValue;

  const setValue = useCallback(
    (newValue: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (newValue === defaultValue) {
        params.delete(key);
      } else {
        params.set(key, newValue);
      }
      const qs = params.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [key, defaultValue, router, pathname, searchParams]
  );

  return [value, setValue];
}
