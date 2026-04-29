import type { CSSProperties } from "react";

export const PCC_TOKENS: CSSProperties = {
  // @ts-expect-error — CSS custom properties
  "--pcc-bg":        "#0E0D0B",
  "--pcc-bg-2":      "#1A1814",
  "--pcc-card":      "#16140F",
  "--pcc-ink":       "#F5F1EA",
  "--pcc-muted":     "#A8A29E",
  "--pcc-quiet":     "#6B655F",
  "--pcc-line":      "rgba(255,255,255,0.08)",
  "--pcc-line-soft": "rgba(255,255,255,0.04)",
  "--pcc-accent":    "#D97706",
};

export const v = (k: string) => `var(--pcc-${k})`;
