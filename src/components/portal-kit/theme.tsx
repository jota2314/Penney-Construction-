"use client";

import { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import { portalFont } from "@/components/portal/portal-font";

/**
 * The portal look, as a wrapper: warm paper, dark ink, terracotta, Manrope.
 * Copied from client-portal-view.tsx's inline style block (that file stays
 * untouched until the client portal moves onto the kit in R3).
 *
 * Light only, no motion, sentence case, Unicode glyphs instead of icons.
 *
 * `variant="field"` is the sub portal's daylight version for a guy in
 * gloves in the sun: muted text darkened to #4F5953 (about 7:1 on white),
 * primary buttons filled with --accent-dark (about 6:1 for white text,
 * against 3.9:1 on --accent), 16px body, 13px smallest label without the
 * wide uppercase tracking, and 16px inputs so iOS never zooms.
 *
 * Heads-up: these classes are plain CSS, not Tailwind layers, so they beat
 * a Tailwind utility on the same element (same as the client portal). Use
 * the modifier classes (.btn-lg, .btn-block) instead of min-h or w utilities
 * on a .btn.
 */

export type PortalVariant = "client" | "field";

export const PORTAL_CSS = `
.pc-portal { --paper:#F7F5F1; --card:#FFFFFF; --ink:#252D2B; --muted:#606B65; --line:#E4E0D8; --accent:#C66638; --accent-dark:#9E4E28; background:var(--paper); color:var(--ink); -webkit-text-size-adjust:100%; }
.pc-portal .card { background:var(--card); border:1px solid var(--line); border-radius:16px; }
.pc-portal .label { font-size:12px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); }
.pc-portal .btn { display:inline-flex; align-items:center; justify-content:center; gap:8px; min-height:44px; padding:0 18px; border-radius:12px; font-weight:700; font-size:15px; }
.pc-portal .btn-primary { background:var(--accent); color:#fff; }
.pc-portal .btn-primary:active { background:var(--accent-dark); }
.pc-portal .btn-ghost { background:#fff; color:var(--ink); border:1px solid var(--line); }
.pc-portal .tabs::-webkit-scrollbar { display:none; }
.pc-portal .clamp3 { display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
.pc-portal .btn:disabled, .pc-portal .btn[aria-disabled="true"] { opacity:.5; }
.pc-portal .btn-lg { min-height:52px; padding:0 20px; font-size:17px; }
.pc-portal .btn-block { display:flex; width:100%; }
.pc-portal .pc-safe-top { padding-top:env(safe-area-inset-top); }
.pc-portal .pc-safe-bottom { padding-bottom:max(16px, env(safe-area-inset-bottom)); }
.pc-portal .pc-safe-x { padding-left:max(16px, env(safe-area-inset-left)); padding-right:max(16px, env(safe-area-inset-right)); }
.pc-portal.pc-field { --muted:#4F5953; font-size:16px; line-height:1.45; }
.pc-portal.pc-field .label { font-size:13px; letter-spacing:.02em; text-transform:none; }
.pc-portal.pc-field .btn { font-size:16px; }
.pc-portal.pc-field .btn-lg { font-size:17px; }
.pc-portal.pc-field .btn-primary { background:var(--accent-dark); }
.pc-portal.pc-field .btn-primary:active { background:#7F3E20; }
.pc-portal.pc-field input, .pc-portal.pc-field textarea, .pc-portal.pc-field select { font-size:16px; }
`;

const PortalVariantContext = createContext<PortalVariant>("client");

/** The variant of the nearest PortalTheme ("client" outside one). */
export function usePortalVariant(): PortalVariant {
  return useContext(PortalVariantContext);
}

/**
 * The classes that put an element inside the portal look. Overlays rendered
 * on <body> (sheets, the photo viewer) use this, since they sit outside the
 * PortalTheme div.
 */
export function portalScopeClass(variant: PortalVariant): string {
  return `pc-portal${variant === "field" ? " pc-field" : ""} ${portalFont.className}`;
}

/** portalScopeClass for the nearest PortalTheme. */
export function usePortalScopeClass(): string {
  return portalScopeClass(usePortalVariant());
}

/** The kit's stylesheet. PortalTheme renders it; render it yourself only outside one. */
export function PortalStyles() {
  return <style>{PORTAL_CSS}</style>;
}

/**
 * "max(16px, env(safe-area-inset-bottom))" — padding that clears the iPhone
 * home bar and notch. Needs viewportFit "cover" (src/app/sub/layout.tsx has it).
 */
export function safeArea(side: "top" | "bottom" | "left" | "right", min = 16): string {
  return `max(${min}px, env(safe-area-inset-${side}))`;
}

export function PortalTheme({
  variant = "client",
  className = "",
  style,
  children,
}: {
  variant?: PortalVariant;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <PortalVariantContext.Provider value={variant}>
      <div className={`${portalScopeClass(variant)} min-h-screen ${className}`} style={style}>
        <PortalStyles />
        {children}
      </div>
    </PortalVariantContext.Provider>
  );
}
