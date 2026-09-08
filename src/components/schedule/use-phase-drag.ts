"use client";

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
} from "react";

export interface PhaseMove {
  id: string;
  start: string;
  end: string;
  days: number;
}

export function moveDate(date: string, days: number) {
  const value = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Explicit move mode reserves bar gestures for dates; ordinary touch scrolling stays native. */
export function usePhaseDrag({
  scrollRef,
  dayWidth,
  nameWidth,
  onMove,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  dayWidth: number;
  nameWidth: number;
  onMove?: (move: PhaseMove) => Promise<boolean>;
}) {
  const [drag, setDrag] = useState<PhaseMove | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const active = useRef(false);
  const cleanup = useRef<() => void>(() => {});
  useEffect(() => () => cleanup.current(), []);

  function begin(
    event: PointerEvent<HTMLButtonElement>,
    phase: Omit<PhaseMove, "days">
  ) {
    const scroller = scrollRef.current;
    if (
      !onMove ||
      !scroller ||
      active.current ||
      !event.isPrimary ||
      event.button !== 0
    )
      return;
    event.preventDefault();
    active.current = true;
    setMessage(null);
    const pointerId = event.pointerId;
    const originX = event.clientX;
    const originScroll = scroller.scrollLeft;
    let x = originX;
    let days = 0;
    let moved = false;
    let frame = 0;
    const button = event.currentTarget;
    button.setPointerCapture(pointerId);
    setDrag({ ...phase, days: 0 });

    const update = () => {
      const distance = x - originX + scroller.scrollLeft - originScroll;
      if (Math.abs(distance) >= 6) moved = true;
      const next = moved ? Math.round(distance / dayWidth) : 0;
      if (next !== days) {
        days = next;
        setDrag({ ...phase, days });
      }
    };
    const autoScroll = () => {
      if (moved) {
        const rect = scroller.getBoundingClientRect();
        if (x < rect.left + nameWidth + 24) scroller.scrollLeft -= 8;
        else if (x > rect.right - 24) scroller.scrollLeft += 8;
        update();
      }
      frame = requestAnimationFrame(autoScroll);
    };
    const move = (e: globalThis.PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      x = e.clientX;
      update();
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancelPointer);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", cancel);
      if (button.hasPointerCapture(pointerId))
        button.releasePointerCapture(pointerId);
      cleanup.current = () => {};
    };
    const cancel = () => {
      stop();
      active.current = false;
      setDrag(null);
    };
    const cancelPointer = (e: globalThis.PointerEvent) => {
      if (e.pointerId === pointerId) cancel();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    };
    const finish = async (e: globalThis.PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      x = e.clientX;
      update();
      stop();
      if (!days) {
        active.current = false;
        setDrag(null);
        return;
      }
      setSaving(true);
      try {
        const saved = await onMove({ ...phase, days });
        setMessage(
          saved
            ? "Dates saved."
            : "Dates could not be saved. The phase has not moved."
        );
      } catch {
        setMessage("Dates could not be saved. Please try again.");
      } finally {
        active.current = false;
        setSaving(false);
        setDrag(null);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancelPointer);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", cancel);
    cleanup.current = stop;
    frame = requestAnimationFrame(autoScroll);
  }

  return { drag, saving, message, begin };
}
