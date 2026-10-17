"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Sticky pill tabs with numeric badges and hash deep links (#dates, #money),
 * copied from the client portal's TabBar and made generic over the tab key.
 * 44px tall so a gloved thumb hits them, 12px apart (plan §2.6; the client
 * bar's 6px is too tight for gloves). The bar scrolls sideways if needed.
 *
 * The URL hash is the only state: useHashTab reads it, and picking a tab
 * rewrites it with replaceState (no history entry per tap, the query string
 * like ?job= is kept).
 */

export interface PortalTabDef<K extends string> {
  key: K;
  label: string;
  /** A count shown as a badge; 0 or missing shows nothing. */
  badge?: number;
  /** Leave it out of the bar (e.g. Money for a worker login). */
  hidden?: boolean;
}

// replaceState doesn't fire hashchange, so picks announce themselves too.
const HASH_EVENT = "pc-portal-hash";

function subscribeHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  window.addEventListener(HASH_EVENT, onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener(HASH_EVENT, onChange);
  };
}
const readHash = () => window.location.hash.replace(/^#/, "");
const serverHash = () => "";

/**
 * The active tab from the URL hash, and a setter. An unknown or empty hash
 * means `fallback`. The setter scrolls to the top, like the client portal.
 */
export function useHashTab<K extends string>(keys: readonly K[], fallback: K): [K, (key: K) => void] {
  const hash = useSyncExternalStore(subscribeHash, readHash, serverHash);
  const active = (keys as readonly string[]).includes(hash) ? (hash as K) : fallback;
  const go = useCallback((key: K) => {
    try {
      history.replaceState(history.state, "", `#${key}`);
    } catch {
      /* ignore: some in-app browsers refuse replaceState */
    }
    window.dispatchEvent(new Event(HASH_EVENT));
    window.scrollTo({ top: 0 });
  }, []);
  return [active, go];
}

export function PortalTabBar<K extends string>({
  tabs,
  active,
  onChange,
  ariaLabel = "Sections",
}: {
  tabs: PortalTabDef<K>[];
  active: K;
  onChange: (key: K) => void;
  ariaLabel?: string;
}) {
  return (
    <nav aria-label={ariaLabel} className="sticky top-0 z-20 border-y border-[var(--line)] bg-[var(--paper)]/95 backdrop-blur">
      <div className="tabs mx-auto flex max-w-2xl gap-3 overflow-x-auto px-3 py-2" style={{ scrollbarWidth: "none" }}>
        {tabs
          .filter((t) => !t.hidden)
          .map(({ key, label, badge = 0 }) => {
            const on = key === active;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onChange(key)}
                aria-current={on ? "page" : undefined}
                className={`flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full px-4 text-[16px] font-bold ${
                  on ? "bg-[var(--ink)] text-white" : "text-[var(--muted)]"
                }`}
              >
                {label}
                {badge > 0 && (
                  <span
                    aria-label={`${badge} waiting`}
                    className={`flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-1.5 text-[13px] ${
                      on ? "bg-white text-[var(--ink)]" : "bg-[var(--accent-dark)] text-white"
                    }`}
                  >
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
      </div>
    </nav>
  );
}
