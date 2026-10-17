"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { safeArea, usePortalScopeClass } from "./theme";

/**
 * A bottom sheet (clock-out, sign, send invoice) that renders on <body>.
 *
 * Why <body>: iOS Safari clips a fixed overlay to the nearest scrolling
 * parent, so a sheet declared inside the page opened squeezed into the
 * middle of the screen with the tab bar over its bottom (crew receipt
 * scanner, Jorge's iPhone 10/1). On <body> at z-[100] it covers the screen
 * on every phone. The portal look rides along via usePortalScopeClass.
 *
 * Two ways out, both big: a 44px Close pill at the top and a full-width
 * Close button at the bottom. The backdrop closes it only when a press both
 * starts and ends on the backdrop, so the camera / file picker and keyboard
 * dictation coming back never close it by accident. Esc closes it too, but
 * only when it's the top overlay (the photo viewer opened from it closes
 * first), and focus goes back to where it was when it closes.
 */

// ─────────────────────────────── body scroll lock

// Ref-counted, so the photo viewer opened over a sheet unlocks only when both close.
let lockCount = 0;
let saved: { scrollY: number; position: string; top: string; left: string; right: string; width: string; overflow: string } | null = null;

/**
 * Stop the page behind an overlay from scrolling. iOS ignores
 * overflow:hidden on <body>, so the body is pinned with position:fixed at
 * its current offset and put back exactly where it was. Returns the release.
 */
export function lockBodyScroll(): () => void {
  if (typeof document === "undefined") return () => {};
  lockCount += 1;
  if (lockCount === 1) {
    const s = document.body.style;
    saved = { scrollY: window.scrollY, position: s.position, top: s.top, left: s.left, right: s.right, width: s.width, overflow: s.overflow };
    s.position = "fixed";
    s.top = `-${saved.scrollY}px`;
    s.left = "0";
    s.right = "0";
    s.width = "100%";
    s.overflow = "hidden";
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0 && saved) {
      const s = document.body.style;
      const { scrollY, position, top, left, right, width, overflow } = saved;
      Object.assign(s, { position, top, left, right, width, overflow });
      saved = null;
      window.scrollTo(0, scrollY);
    }
  };
}

/** Lock the body's scroll while `active` (default: while mounted). */
export function useBodyScrollLock(active = true) {
  useEffect(() => (active ? lockBodyScroll() : undefined), [active]);
}

// ─────────────────────────────── overlay stack (Esc and focus)

// Open sheets and photo viewers, newest last. Each listens for Esc on window,
// so without this one Esc in the viewer over a sheet closed both.
const overlayStack: symbol[] = [];

/**
 * Join the overlay stack while mounted. Esc calls `onEscape` only when this
 * overlay is the top one, and when it unmounts focus goes back to the
 * element that had it when it opened (the button that opened it, or the
 * thumbnail under the viewer). The latest `onEscape` is always used, so a
 * sheet that becomes `locked` can ignore Esc without re-registering.
 */
export function useOverlayLayer(onEscape: () => void) {
  const escapeRef = useRef(onEscape);
  useEffect(() => {
    escapeRef.current = onEscape;
  });
  useEffect(() => {
    const token = Symbol("portal-overlay");
    overlayStack.push(token);
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || overlayStack[overlayStack.length - 1] !== token) return;
      e.preventDefault();
      escapeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const i = overlayStack.indexOf(token);
      if (i !== -1) overlayStack.splice(i, 1);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
}

// ─────────────────────────────── helpers

const noSubscribe = () => () => {};

/** False during server render and hydration, true after: portals need document.body. */
export function useIsClient(): boolean {
  return useSyncExternalStore(noSubscribe, () => true, () => false);
}

/** Lift the sheet above the on-screen keyboard (same rules as the crew sheets). */
function useKeyboardInset() {
  const [inset, setInset] = useState({ kb: 0, maxH: null as number | null });
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const gap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
        const open = gap > 120;
        setInset({ kb: open ? gap : 0, maxH: open ? vv.height - 12 : null });
      });
    };
    update();
    vv.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener("resize", update);
    };
  }, []);
  return inset;
}

// ─────────────────────────────── the sheet

export function PortalSheet({
  title,
  onClose,
  children,
  footer,
  locked = false,
  closeLabel = "Close",
  bottomClose = true,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** The sheet's own buttons (e.g. "Accept and sign"), above the bottom Close. */
  footer?: ReactNode;
  /** While something can't be interrupted (an upload), nothing closes the sheet. */
  locked?: boolean;
  closeLabel?: string;
  /** The full-width Close button at the bottom. On by default. */
  bottomClose?: boolean;
}) {
  const scope = usePortalScopeClass();
  const isClient = useIsClient();
  const { kb, maxH } = useKeyboardInset();
  const pressOnBackdrop = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useBodyScrollLock(true);
  // Before the focus effect below, so it remembers what had focus first.
  useOverlayLayer(() => {
    if (!locked) onClose();
  });

  // Screen readers land in the sheet, not on the page behind it.
  useEffect(() => {
    if (isClient) dialogRef.current?.focus({ preventScroll: true });
  }, [isClient]);

  if (!isClient) return null;
  return createPortal(
    <div
      className={`${scope} fixed inset-0 z-[100] flex items-end justify-center sm:items-center`}
      style={{ background: "rgba(37,45,43,0.55)", paddingBottom: kb }}
      onPointerDown={(e) => {
        pressOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        const fromBackdrop = pressOnBackdrop.current && e.target === e.currentTarget;
        pressOnBackdrop.current = false;
        if (fromBackdrop && !locked) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="flex w-full flex-col overflow-hidden rounded-t-[20px] bg-[var(--card)] text-[var(--ink)] outline-none sm:max-w-[480px] sm:rounded-[20px]"
        style={{ maxHeight: maxH ?? "92dvh" }}
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-[var(--line)] px-4 py-2">
          <h2 className="min-w-0 flex-1 truncate text-[18px] font-extrabold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={locked}
            className="inline-flex min-h-[44px] shrink-0 items-center rounded-full border border-[var(--line)] bg-[var(--paper)] px-4 text-[15px] font-bold disabled:opacity-50"
          >
            {closeLabel}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">{children}</div>
        {(footer || bottomClose) && (
          <div className="shrink-0 space-y-3 border-t border-[var(--line)] px-4 pt-3" style={{ paddingBottom: safeArea("bottom") }}>
            {footer}
            {bottomClose && (
              <button type="button" onClick={onClose} disabled={locked} className="btn btn-ghost btn-block">
                {closeLabel}
              </button>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
