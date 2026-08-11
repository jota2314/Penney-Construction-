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
 * Detection is purely geometric: the visible viewport height (zoom-corrected)
 * dropped more than KEYBOARD_MIN_PX below the tallest height seen at the
 * current width. That covers browser tabs AND home-screen (standalone) PWAs —
 * where the layout viewport shrinks with the keyboard and inset math reads 0 —
 * and it self-recovers the moment the keyboard actually closes.
 *
 * Deliberately NOT based on "a text field has focus": Android keeps the field
 * focused when the keyboard is dismissed with the back button/gesture, so a
 * focus-based signal sticks ON and left the bottom nav hidden until the user
 * happened to tap elsewhere.
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

    const update = () => {
      const scale = vv.scale || 1;
      const width = Math.round(vv.width * scale);
      const height = Math.round(vv.height * scale);
      if (Math.abs(width - baselineWidth) > 4) {
        baselineWidth = width;
        baselineHeight = height;
      }
      if (height > baselineHeight) baselineHeight = height;
      setOpen(baselineHeight - height > KEYBOARD_MIN_PX);
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return open;
}

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
