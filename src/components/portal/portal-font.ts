import localFont from "next/font/local";

// The client portal's type: bold, readable sans (Jorge picked Manrope for the
// Penney site over thin display serifs). Loaded only where the portal renders.
// Official Google Fonts variable font, bundled with its OFL license so builds
// never depend on a font-service response. Unmodified source:
// https://github.com/google/fonts/tree/b31870aff700ab7a1d74fa0c6887d95beb9e0037/ofl/manrope
export const portalFont = localFont({
  src: "./fonts/Manrope-Variable.ttf",
  weight: "400 800",
  style: "normal",
  display: "swap",
});
