import { Manrope } from "next/font/google";

// The client portal's type: bold, readable sans (Jorge picked Manrope for the
// Penney site over thin display serifs). Loaded only where the portal renders.
export const portalFont = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});
