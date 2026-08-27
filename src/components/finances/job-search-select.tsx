"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type CaptureJobOption } from "@/lib/actions/field-capture";

/**
 * Shared job picker for every surface that points money at a job.
 *
 * Lives here rather than inside one workbench because the office "Add a bill"
 * dialog needs exactly the same thing the spend organizer does: the FULL job
 * list, grouped, searchable. When the bill dialog had its own narrow picker
 * (contracted + in_progress only), a real invoice for a job in `audit` had no
 * pickable destination at all and got filed with no job — see
 * listCaptureJobOptions for why every state has to stay reachable.
 */

export const BUCKET_HEADERS: Record<CaptureJobOption["bucket"], string> = {
  internal: "Company",
  active: "Active jobs",
  other: "Completed & other",
};

/**
 * Type-to-search job picker. A native <select> over 120 projects made finding
 * a job a scroll hunt; this filters as you type on number + name, keeps the
 * Company / Active / other grouping, and stays a plain controlled component.
 *
 * The menu is portaled to <body> and positioned fixed off the trigger's rect:
 * every row card runs the .so-rise transform animation, which makes each card
 * its own stacking context, so an in-flow absolute menu painted UNDER the rows
 * below it. Portaling also frees it from the sidebar's overflow-hidden.
 */
export function JobSearchSelect({
  jobs,
  value,
  onChange,
  placeholder,
  allowNone,
  className,
}: {
  jobs: CaptureJobOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
  allowNone?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [menuBox, setMenuBox] = useState<{ left: number; top: number; width: number } | null>(null);

  // Anchor the portaled menu to the trigger, flipping above it when the
  // viewport runs out of room below.
  useEffect(() => {
    if (!open) return;

    function place() {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = Math.max(r.width, 270);
      const menuH = 320; // search box + max-h-64 list
      const below = window.innerHeight - r.bottom;
      const top = below < menuH && r.top > below ? r.top - Math.min(menuH, r.top) - 4 : r.bottom + 4;
      setMenuBox({
        left: Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - width - 8)),
        top,
        width,
      });
    }

    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  const selected = jobs.find((j) => j.id === value) ?? null;
  const q = query.trim().toLowerCase();
  const filtered = q ? jobs.filter((j) => j.label.toLowerCase().includes(q)) : jobs;

  function close() {
    setOpen(false);
    setQuery("");
  }

  function pick(id: string) {
    onChange(id);
    close();
  }

  return (
    <div className={`relative ${className ?? ""}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setTimeout(() => searchRef.current?.focus(), 0);
        }}
        className={`h-8 w-full flex items-center justify-between gap-1 rounded-lg border bg-background px-2 text-left text-xs transition-colors hover:border-amber-500/40 ${
          open ? "border-amber-500/60 ring-2 ring-amber-500/15" : ""
        }`}
      >
        <span className={`truncate ${selected ? "" : "text-muted-foreground"}`}>
          {selected ? `${selected.internal ? "★ " : ""}${selected.label}` : placeholder}
        </span>
        <svg
          className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 12 12"
          fill="none"
        >
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {open &&
        menuBox &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[90]" onClick={close} />
            <div
              style={{ left: menuBox.left, top: menuBox.top, width: menuBox.width }}
              className="fixed z-[91] overflow-hidden rounded-xl border border-border/80 bg-popover shadow-2xl shadow-black/40 so-rise"
              onKeyDown={(e) => {
                if (e.key === "Escape") close();
              }}
            >
              <div className="flex items-center gap-2 border-b bg-muted/30 px-2.5 py-2">
                <svg className="h-3.5 w-3.5 shrink-0 text-muted-foreground" viewBox="0 0 16 16" fill="none">
                  <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search jobs…"
                  className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                />
              </div>
              <div className="max-h-64 overflow-y-auto overscroll-contain py-1">
                {allowNone && (
                  <button
                    type="button"
                    onClick={() => pick("")}
                    className={`w-full px-2.5 py-1.5 text-left text-xs italic text-muted-foreground transition-colors hover:bg-muted/50 ${
                      !value ? "bg-amber-500/15" : ""
                    }`}
                  >
                    No job
                  </button>
                )}
                {filtered.length === 0 && (
                  <div className="px-2.5 py-3 text-center text-xs italic text-muted-foreground">
                    Nothing matches
                  </div>
                )}
                {(["internal", "active", "other"] as const).map((bucket) => {
                  const group = filtered.filter((j) => j.bucket === bucket);
                  if (group.length === 0) return null;
                  return (
                    <div key={bucket}>
                      <div className="px-2.5 pt-2 pb-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70 font-semibold">
                        {BUCKET_HEADERS[bucket]}
                      </div>
                      {group.map((j) => (
                        <button
                          key={j.id}
                          type="button"
                          onClick={() => pick(j.id)}
                          className={`w-full px-2.5 py-1.5 text-left text-xs truncate transition-colors hover:bg-amber-500/10 ${
                            j.id === value ? "bg-amber-500/15 text-amber-500" : ""
                          }`}
                          title={j.label}
                        >
                          {j.internal ? "★ " : ""}
                          {j.label}
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
