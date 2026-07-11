"use client";

import { useEffect, useState } from "react";

/**
 * Tracks the on-screen keyboard. iOS doesn't resize the layout viewport when
 * the keyboard opens — it pans it, dragging `position: fixed` chrome along
 * with it (bottom nav floats mid-screen, bottom sheets get shoved under the
 * status bar). The visual viewport API is the only reliable signal.
 *
 * Returns { inset, height, bottomGap }: `inset` is the px the keyboard steals
 * (0 when closed), `height` is the currently visible viewport height, and
 * `bottomGap` is how far the layout viewport's bottom edge sits below the
 * visible area (i.e. behind the keyboard, after any iOS pan). Anchoring a
 * `position: fixed; bottom: 0` element `bottomGap` px up puts it right on
 * top of the keyboard.
 */
/** Input types that never raise an on-screen keyboard. */
const NON_TEXT_INPUT_TYPES = new Set([
  "button", "checkbox", "radio", "range", "file", "submit", "reset", "color", "image",
]);

function isTextEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.has(el.type);
}

/**
 * True while the on-screen keyboard is (very likely) open. Combines the
 * visual-viewport inset with "a text field has focus" — in iOS home-screen
 * (standalone) mode the layout viewport shrinks WITH the keyboard, so the
 * inset math reads 0 even though the keyboard is up. Focus tracking catches
 * that case; the inset catches keyboards dismissed without blurring.
 */
export function useKeyboardOpen(): boolean {
  const { inset } = useKeyboardInset();
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      if (isTextEditable(e.target)) setEditing(true);
    };
    const onFocusOut = () => {
      // Focus may be moving to another field — settle before deciding.
      requestAnimationFrame(() => setEditing(isTextEditable(document.activeElement)));
    };
    setEditing(isTextEditable(document.activeElement));
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  return inset > 0 || editing;
}

export function useKeyboardInset(): {
  inset: number;
  height: number;
  bottomGap: number;
} {
  const [state, setState] = useState({ inset: 0, height: 0, bottomGap: 0 });

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      const stolen = window.innerHeight - vv.height;
      // Under ~120px it's browser chrome (URL bar collapse), not a keyboard.
      const inset = stolen > 120 ? Math.round(stolen) : 0;
      const bottomGap =
        inset > 0
          ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))
          : 0;
      setState((prev) =>
        prev.inset === inset &&
        prev.height === Math.round(vv.height) &&
        prev.bottomGap === bottomGap
          ? prev
          : { inset, height: Math.round(vv.height), bottomGap },
      );
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return state;
}
