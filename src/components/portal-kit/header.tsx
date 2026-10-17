import type { ReactNode } from "react";

/**
 * The portal header: a 4px terracotta strip, then the ink bar with the white
 * logo chip. Copied from client-portal-view.tsx.
 *
 * Two lines beside the logo, like the client portal: `subtitle` is the small
 * line on top ("Penney Construction · Sub portal") and `title` the bold one
 * under it (the company). `right` holds a header action, e.g.
 * <HeaderAction href="tel:9786214387" label="Call" />.
 */
export function PortalHeader({
  title,
  subtitle = "Penney Construction",
  right,
  safeTop = false,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  /** Pad under the notch (a Home Screen app with a translucent status bar). */
  safeTop?: boolean;
}) {
  return (
    <>
      <div className={`h-1 bg-[var(--accent)] ${safeTop ? "box-content pc-safe-top" : ""}`} />
      <header className="bg-[var(--ink)] text-white">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <span className="flex h-11 w-[68px] shrink-0 items-center justify-center rounded-lg bg-white px-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-email.jpg" alt="Penney Construction" className="max-h-9 w-auto" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-white/75">{subtitle}</p>
            <p className="truncate text-[16px] font-bold leading-tight">{title}</p>
          </div>
          {right && <div className="shrink-0">{right}</div>}
        </div>
      </header>
    </>
  );
}

/** A 44px pill for the header's right slot: a link (tel:, mailto:, a page) or a button. */
export function HeaderAction({
  label,
  href,
  onClick,
  ariaLabel,
}: {
  label: string;
  href?: string;
  onClick?: () => void;
  ariaLabel?: string;
}) {
  const className =
    "inline-flex min-h-[44px] items-center justify-center rounded-full bg-white/15 px-4 text-[15px] font-bold text-white";
  if (href) {
    return (
      <a href={href} aria-label={ariaLabel ?? label} className={className}>
        {label}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-label={ariaLabel ?? label} className={className}>
      {label}
    </button>
  );
}
