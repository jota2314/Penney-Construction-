"use client";

import { useRef, useState } from "react";
import type React from "react";

interface SwipeCarouselOptions {
  count: number;
  index: number;
  onIndexChange: (next: number) => void;
}

/**
 * Touch-drag support for a horizontal carousel built as a flex track
 * (slides are `w-full flex-shrink-0`, track is translated by -index * 100%).
 *
 * Attach `handlers` + `touch-action: pan-y` to the overflow-hidden wrapper and
 * `trackStyle` to the flex track. The finger drags the track live; on release
 * it snaps to the neighbor when the drag passes the threshold, with a
 * rubber-band feel at the first/last slide. `consumeSwipe()` lets tap handlers
 * on slides ignore the click that follows a swipe gesture.
 */
export function useSwipeCarousel({ count, index, onIndexChange }: SwipeCarouselOptions) {
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<"h" | "v" | null>(null);
  const width = useRef(1);
  const swiped = useRef(false);

  const onTouchStart = (e: React.TouchEvent<HTMLElement>) => {
    swiped.current = false;
    if (count < 2) return;
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY };
    axis.current = null;
    width.current = e.currentTarget.clientWidth || 1;
  };

  const onTouchMove = (e: React.TouchEvent<HTMLElement>) => {
    if (!start.current) return;
    const t = e.touches[0];
    const dx = t.clientX - start.current.x;
    const dy = t.clientY - start.current.y;
    if (!axis.current) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      axis.current = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
      if (axis.current === "h") setDragging(true);
    }
    if (axis.current !== "h") return;
    const atEdge = (index === 0 && dx > 0) || (index === count - 1 && dx < 0);
    setDragX(atEdge ? dx / 3 : dx);
  };

  const settle = () => {
    if (axis.current === "h") {
      if (Math.abs(dragX) > 6) swiped.current = true;
      const threshold = Math.min(width.current * 0.2, 70);
      if (dragX <= -threshold && index < count - 1) onIndexChange(index + 1);
      else if (dragX >= threshold && index > 0) onIndexChange(index - 1);
    }
    start.current = null;
    axis.current = null;
    setDragX(0);
    setDragging(false);
  };

  /** True (and resets) when the gesture that just ended was a swipe, not a tap. */
  const consumeSwipe = () => {
    const s = swiped.current;
    swiped.current = false;
    return s;
  };

  return {
    handlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd: settle,
      onTouchCancel: settle,
    },
    trackStyle: {
      transform: `translateX(calc(${-index * 100}% + ${dragX}px))`,
      transition: dragging ? "none" : "transform 280ms cubic-bezier(0.22, 0.61, 0.36, 1)",
    } as React.CSSProperties,
    consumeSwipe,
  };
}
