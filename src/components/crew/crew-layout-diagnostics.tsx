"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

function measureLayout() {
  const round = (value: number) => Math.round(value * 10) / 10;
  const bounds = (element: Element | null) => {
    if (!element) return "missing";
    const r = element.getBoundingClientRect();
    return `top ${round(r.top)}, bottom ${round(r.bottom)}, h ${round(r.height)}`;
  };
  const shell = document.querySelector("[data-crew-viewport]");
  const nav = document.querySelector('nav[aria-label="Crew navigation"]');
  const vv = window.visualViewport;
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)";
  document.body.appendChild(probe);
  const safe = getComputedStyle(probe);
  const insets = `${safe.paddingTop} / ${safe.paddingBottom}`;
  probe.remove();
  return [
    "Layout diagnostic 1 · live measurements",
    `Window: ${innerWidth} × ${innerHeight}`,
    `Document: ${document.documentElement.clientWidth} × ${document.documentElement.clientHeight}`,
    `Screen: ${screen.width} × ${screen.height}, DPR ${devicePixelRatio}`,
    `Visual: ${vv ? `${round(vv.width)} × ${round(vv.height)}, top ${round(vv.offsetTop)}, scale ${round(vv.scale)}` : "unavailable"}`,
    `Safe top / bottom: ${insets}`,
    `Scroll: ${round(scrollX)}, ${round(scrollY)}`,
    `Home Screen: ${(navigator as Navigator & {standalone?: boolean}).standalone === true}`,
    `Standalone media: ${matchMedia("(display-mode: standalone)").matches}`,
    `Status style: ${document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute("content")}`,
    `Shell: ${bounds(shell)}`,
    `Nav: ${bounds(nav)}`,
    `Nav bottom padding: ${nav ? getComputedStyle(nav).paddingBottom : "missing"}`,
    `Label: ${bounds(nav?.querySelector("a span") ?? null)}`,
    navigator.userAgent,
  ].join("\n");
}

/** Five taps on the existing title enable local-only layout troubleshooting. */
export function CrewLayoutDiagnostics() {
  const taps = useRef({count: 0, last: 0});
  const [report, setReport] = useState<string | null>(null);
  const open = report !== null;
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setReport(measureLayout()), 500);
    return () => clearInterval(timer);
  }, [open]);
  function activate() {
    const now = Date.now();
    taps.current.count = now - taps.current.last > 3000 ? 1 : taps.current.count + 1;
    taps.current.last = now;
    if (taps.current.count >= 5) {
      taps.current.count = 0;
      setReport(measureLayout());
    }
  }
  return <>
    <button type="button" className="font-semibold text-sm" onClick={activate}>Crew</button>
    {open && createPortal(
      <section role="dialog" aria-label="Layout diagnostics" className="fixed z-[100] inset-x-3 top-[20%] max-h-[65dvh] overflow-y-auto rounded-xl border border-amber-500 bg-zinc-950 p-3 text-white shadow-xl">
        <div className="flex items-center justify-between gap-3 mb-2">
          <strong className="text-sm">Screen measurements</strong>
          <button type="button" className="px-3 py-2 border rounded" onClick={() => setReport(null)}>Close</button>
        </div>
        <p className="text-xs mb-2">Send a screenshot of this panel. No information is uploaded automatically.</p>
        <pre className="text-[11px] leading-relaxed whitespace-pre-wrap break-words">{report}</pre>
      </section>, document.body
    )}
  </>;
}
