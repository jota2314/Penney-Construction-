"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Exposes "can this user delete feed items" to every client component under the
 * app layout, so cards (company posts, daily logs, punch lists) can show a
 * delete control without each page prop-threading the current user down.
 */
const CanManageFeedContext = createContext(false);

export function FeedPermissionsProvider({
  canManage,
  children,
}: {
  canManage: boolean;
  children: ReactNode;
}) {
  return (
    <CanManageFeedContext.Provider value={canManage}>
      {children}
    </CanManageFeedContext.Provider>
  );
}

export function useCanManageFeed(): boolean {
  return useContext(CanManageFeedContext);
}
