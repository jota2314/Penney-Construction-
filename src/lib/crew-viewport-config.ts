import type { Viewport } from "next";

// Keep crew controls inside the browser-managed safe rectangle. Cover mode
// asks the page to draw under system bars and gives installed iOS windows
// inconsistent height/origin measurements (WebKit 254868).
export const crewViewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "auto",
  themeColor: "#0f0f10",
};
