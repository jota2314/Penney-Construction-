"use client";

import { useEffect, useState } from "react";

/**
 * Tracks the on-screen keyboard. iOS doesn't resize the layout viewport when
 * the keyboard opens — it pans it, dragging `position: fixed` chrome along
 * with it (bottom nav floats mid-screen, bottom sheets get shoved under the
 * status bar). The visual viewport API is the only reliable signal.
 *
 * All math multiplies `vv.height` by `vv.scale`: pinch-zooming shrinks
 * `vv.height` by the zoom factor while `height × scale` stays put, so a
 * zoomed page never reads as "keyboard open" (it used to hide the bottom
 * nav whenever someone zoomed into a photo or PDF).
 */

/**
 * True while the on-screen keyboard is (very likely) open.
 *
 * Two signals have to agree, and that pairing is the whole point:
 *
 * 1. Something text-entry-ish has focus. A keyboard cannot be open with
 *    nothing focused, so this alone rules out every look-alike: browser
 *    toolbars collapsing on scroll, pinch-zoom, rotation, a full-screen
 *    photo/PDF view — all of which change the visible height by keyboard-ish
 *    amounts.
 * 2. The visible viewport height (zoom-corrected) dropped more than
 *    KEYBOARD_MIN_PX below the tallest height seen at the current width.
 *    That covers browser tabs AND home-screen (standalone) PWAs — where the
 *    layout viewport shrinks with the keyboard and inset math reads 0.
 *
 * Focus alone is not enough either: Android keeps the field focused when the
 * keyboard is dismissed with the back button/gesture, so a focus-only signal
 * sticks ON and leaves the bottom nav hidden until the user taps elsewhere.
 * The geometric half self-recovers there.
 *
 * The baseline height only ever ratchets UP, so one freak tall reading used to
 * strand the nav in the hidden state for the life of the page (closing and
 * reopening the app was the only cure). Now the baseline is re-anchored to the
 * live viewport shortly after focus leaves — and whenever the app comes back
 * to the foreground — so the hidden state can never outlive the keyboard.
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    // Tallest zoom-corrected height seen at the current width. A width change
    // means rotation or split-screen — start a fresh baseline.
    let baselineWidth = 0;
    let baselineHeight = 0;
    let reanchorTimer: ReturnType<typeof setTimeout> | undefined;

    const measure = () => {
      const scale = vv.scale || 1;
      return {
        width: Math.round(vv.width * scale),
        height: Math.round(vv.height * scale),
      };
    };

    const cancelReanchor = () => {
      if (reanchorTimer !== undefined) {
        clearTimeout(reanchorTimer);
        reanchorTimer = undefined;
      }
    };

    // Treat the viewport as it stands right now as "keyboard closed".
    const reanchor = () => {
      reanchorTimer = undefined;
      const { width, height } = measure();
      baselineWidth = width;
      baselineHeight = height;
      setOpen(false);
    };

    const update = () => {
      // Readings taken while the app is backgrounded are not trustworthy and
      // must never poison the baseline.
      if (document.visibilityState === "hidden") return;

      const { width, height } = measure();

      if (isTextEntry(document.activeElement)) {
        cancelReanchor();
      } else if (reanchorTimer === undefined) {
        // Nothing focused → no keyboard. Give the close animation a beat to
        // finish (so the nav doesn't pop up through a sliding keyboard), then
        // reset the baseline unconditionally. This is the escape hatch that
        // guarantees the nav comes back.
        reanchorTimer = setTimeout(reanchor, KEYBOARD_CLOSE_MS);
      }

      if (Math.abs(width - baselineWidth) > 4) {
        baselineWidth = width;
        baselineHeight = height;
      }
      if (height > baselineHeight) baselineHeight = height;
      setOpen(baselineHeight - height > KEYBOARD_MIN_PX);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") update();
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("focusin", update);
    window.addEventListener("focusout", update);
    window.addEventListener("pageshow", onVisibility);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelReanchor();
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("focusin", update);
      window.removeEventListener("focusout", update);
      window.removeEventListener("pageshow", onVisibility);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return open;
}

/** Input types that open a text keyboard (checkbox, button, etc. do not). */
const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

function isTextEntry(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) {
    return (
      !el.readOnly && !el.disabled && !NON_TEXT_INPUT_TYPES.has(el.type)
    );
  }
  return el instanceof HTMLElement && el.isContentEditable;
}

/** Roughly how long a mobile keyboard takes to slide away. */
const KEYBOARD_CLOSE_MS = 350;

/**
 * Below this, a height change is browser chrome (URL bar collapse ~56-100px),
 * not a keyboard (~250px+).
 */
const KEYBOARD_MIN_PX = 120;

/**
 * Returns { inset, height, bottomGap }: `inset` is the px the keyboard steals
 * (0 when closed), `height` is the currently visible viewport height, and
 * `bottomGap` is how far the layout viewport's bottom edge sits below the
 * visible area (i.e. behind the keyboard, after any iOS pan). Anchoring a
 * `position: fixed; bottom: 0` element `bottomGap` px up puts it right on
 * top of the keyboard.
 */
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
      const scale = vv.scale || 1;
      const stolen = window.innerHeight - vv.height * scale;
      const inset = stolen > KEYBOARD_MIN_PX ? Math.round(stolen) : 0;
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
