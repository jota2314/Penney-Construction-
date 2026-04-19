"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

const THRESHOLD = 70;
const MAX_PULL = 110;
const RESISTANCE = 0.5;

function findScrollableAncestor(el: HTMLElement | null): HTMLElement | null {
  let node: HTMLElement | null = el;
  while (node && node !== document.body) {
    const style = getComputedStyle(node);
    const overflowY = style.overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return document.scrollingElement as HTMLElement | null;
}

export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const tracking = useRef(false);
  const startY = useRef(0);
  const pullRef = useRef(0);

  useEffect(() => {
    const onTouchStart = (e: TouchEvent) => {
      if (refreshing) return;
      const target = e.target as HTMLElement;
      const scrollable = findScrollableAncestor(target);
      if (scrollable && scrollable.scrollTop <= 0) {
        startY.current = e.touches[0].clientY;
        tracking.current = true;
        pullRef.current = 0;
      } else {
        tracking.current = false;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!tracking.current || refreshing) return;
      const delta = e.touches[0].clientY - startY.current;
      if (delta <= 0) {
        if (pullRef.current !== 0) {
          pullRef.current = 0;
          setPull(0);
        }
        return;
      }
      const resisted = Math.min(MAX_PULL, delta * RESISTANCE);
      pullRef.current = resisted;
      setPull(resisted);
    };

    const onTouchEnd = () => {
      if (!tracking.current) return;
      tracking.current = false;
      if (pullRef.current >= THRESHOLD) {
        setRefreshing(true);
        setPull(THRESHOLD);
        router.refresh();
        window.setTimeout(() => {
          setRefreshing(false);
          setPull(0);
          pullRef.current = 0;
        }, 600);
      } else {
        setPull(0);
        pullRef.current = 0;
      }
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [refreshing, router]);

  const progress = Math.min(1, pull / THRESHOLD);
  const showing = pull > 0 || refreshing;

  return (
    <>
      {showing && (
        <div
          className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center"
          style={{
            transform: `translateY(${Math.max(8, pull - 20)}px)`,
            opacity: refreshing ? 1 : progress,
            transition: tracking.current ? "none" : "transform 220ms ease-out, opacity 220ms ease-out",
          }}
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-amber-500/30 bg-card shadow-lg">
            <RefreshCw
              className={`h-5 w-5 text-amber-500 ${refreshing ? "animate-spin" : ""}`}
              style={!refreshing ? { transform: `rotate(${progress * 270}deg)` } : undefined}
            />
          </div>
        </div>
      )}
      {children}
    </>
  );
}
