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
