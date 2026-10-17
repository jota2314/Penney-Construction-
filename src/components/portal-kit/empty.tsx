import type { ReactNode } from "react";

/**
 * The empty state: one plain sentence saying when something will show up
 * ("No drawings posted for this job yet."), copied from the client portal.
 * An optional action sits under it.
 */
export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="card p-6 text-center text-[16px] text-[var(--muted)]">
      <p>{children}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
