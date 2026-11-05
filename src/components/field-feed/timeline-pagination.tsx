"use client";

import { useEffect, useRef } from "react";

export function TimelinePagination({ hasMore, loading, error, loadMore, filtered }: {
  hasMore: boolean; loading: boolean; error: boolean; loadMore: () => Promise<void>; filtered: boolean;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!hasMore || loading || error || !sentinel.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore();
    }, { rootMargin: "600px 0px" });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [hasMore, loading, error, loadMore]);

  return (
    <div ref={sentinel} className="flex min-h-24 flex-col items-center justify-center gap-2 py-6 text-center text-sm" style={{ color: "var(--pcc-muted)" }} aria-live="polite" aria-busy={loading}>
      {error ? <><p>Couldn’t load updates.</p><button type="button" onClick={() => void loadMore()} className="rounded-lg border border-amber-700 px-4 py-2 text-amber-400">Retry</button></> :
        loading ? <p>Loading more updates…</p> : hasMore ?
          <button type="button" onClick={() => void loadMore()} className="rounded-lg border border-stone-700 px-4 py-2">Load more updates</button> :
          <p>{filtered ? "You’ve reached the end of this date range. Choose All for older updates." : "You’ve reached the beginning of the updates."}</p>}
    </div>
  );
}
