import type { ReactNode } from "react";

/** The staff/draft maroon, from the client portal. */
export const STAFF_MAROON = "#7A2E12";

/**
 * The maroon bar across the top of a staff preview, copied from the client
 * portal's PreviewBanner. `detail` is free text built by the loader, e.g.
 * "Portal on · PIN set · Invited Oct 17 · Last real visit Oct 16 · Nothing
 * you tap here is saved."
 */
export function PreviewBanner({
  title = "Staff preview",
  detail,
}: {
  /** "Staff preview of MGL Tile Inc's portal". */
  title?: string;
  detail?: ReactNode;
}) {
  return (
    <div role="note" className="px-4 py-2.5 text-white" style={{ background: STAFF_MAROON }}>
      <div className="mx-auto max-w-2xl">
        <p className="text-[15px] font-extrabold">{title}</p>
        {detail && <p className="text-[14px] leading-snug text-white/90">{detail}</p>}
      </div>
    </div>
  );
}

/** A small solid maroon chip for staff-only things ("Draft · not visible to the sub"). */
export function StaffChip({ children = "Draft" }: { children?: ReactNode }) {
  return (
    <span className="inline-block rounded-md px-2 py-0.5 text-[13px] font-bold text-white" style={{ background: STAFF_MAROON }}>
      {children}
    </span>
  );
}
