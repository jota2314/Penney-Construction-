"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { v } from "@/components/field-feed/tokens";

/** Building blocks for the crew receipt scanner. Dark field tokens only. */

export const money = (n: number | null | undefined): string =>
  typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString("en-US", { style: "currency", currency: "USD" })
    : "—";

export const round2 = (n: number): number => Math.round(n * 100) / 100;

export const TONE = {
  ok: { fg: "#4ADE80", bg: "rgba(34,197,94,0.10)", line: "rgba(34,197,94,0.28)" },
  warn: { fg: "#FBBF24", bg: "rgba(217,119,6,0.12)", line: "rgba(217,119,6,0.32)" },
  error: { fg: "#F87171", bg: "rgba(248,113,113,0.10)", line: "rgba(248,113,113,0.30)" },
  info: { fg: "#A8A29E", bg: "rgba(255,255,255,0.03)", line: "rgba(255,255,255,0.08)" },
} as const;
export type Tone = keyof typeof TONE;

/* ------------------------------------------------------------------ icons */

type IconProps = { className?: string; style?: CSSProperties };
const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const IconReceipt = (p: IconProps) => (
  <svg viewBox="0 0 20 20" {...stroke} {...p}>
    <path d="M5 2.5h10a.5.5 0 0 1 .5.5v14l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2-1 .6V3a.5.5 0 0 1 .5-.5z" />
    <path d="M7.5 6.5h5M7.5 9.5h5M7.5 12.5h3" />
  </svg>
);
export const IconCamera = (p: IconProps) => (
  <svg viewBox="0 0 20 20" {...stroke} {...p}>
    <path d="M4 6h3l1.5-2h3L13 6h3a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z" />
    <circle cx="10" cy="11" r="2.75" />
  </svg>
);
export const IconX = (p: IconProps) => (
  <svg viewBox="0 0 20 20" {...stroke} {...p}><path d="M5 5l10 10M15 5L5 15" /></svg>
);
export const IconBack = (p: IconProps) => (
  <svg viewBox="0 0 20 20" {...stroke} {...p}><path d="M12.5 4.5L7 10l5.5 5.5" /></svg>
);
export const IconChevron = (p: IconProps) => (
  <svg viewBox="0 0 20 20" {...stroke} {...p}><path d="M7.5 4.5L13 10l-5.5 5.5" /></svg>
);
export const IconCheck = (p: IconProps) => (
  <svg viewBox="0 0 20 20" {...stroke} {...p}><path d="M4.5 10.5l3.5 3.5 7.5-8" /></svg>
);
export const IconAlert = (p: IconProps) => (
  <svg viewBox="0 0 20 20" {...stroke} {...p}>
    <path d="M10 3.2l7.2 12.6H2.8z" /><path d="M10 8.2v3.4M10 13.9v.1" />
  </svg>
);
export const IconSearch = (p: IconProps) => (
  <svg viewBox="0 0 20 20" {...stroke} {...p}><circle cx="9" cy="9" r="5.5" /><path d="M13.2 13.2L17 17" /></svg>
);
export const IconPlus = (p: IconProps) => (
  <svg viewBox="0 0 20 20" {...stroke} {...p}><path d="M10 4.5v11M4.5 10h11" /></svg>
);
export const IconPin = (p: IconProps) => (
  <svg viewBox="0 0 20 20" {...stroke} {...p}>
    <path d="M10 17.5s5.5-5 5.5-9.25a5.5 5.5 0 0 0-11 0C4.5 12.5 10 17.5 10 17.5z" /><circle cx="10" cy="8.25" r="2" />
  </svg>
);
export const IconClock = (p: IconProps) => (
  <svg viewBox="0 0 20 20" {...stroke} {...p}><circle cx="10" cy="10" r="7" /><path d="M10 6v4l2.5 1.5" /></svg>
);

export function Spinner({ size = 16, color }: { size?: number; color?: string }) {
  return (
    <span
      className="inline-block shrink-0 rounded-full animate-spin"
      style={{ width: size, height: size, border: `2px solid ${v("line")}`, borderTopColor: color ?? v("accent") }}
    />
  );
}

/* ----------------------------------------------------------------- layout */

/** Lift the sheet above the on-screen keyboard (same rules as the clock-in sheet). */
function useKeyboardInset() {
  const [inset, setInset] = useState({ kb: 0, maxH: null as number | null });
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const gap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
        const open = gap > 120;
        setInset({ kb: open ? gap : 0, maxH: open ? vv.height - 12 : null });
      });
    };
    update();
    vv.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener("resize", update);
    };
  }, []);
  return inset;
}

export function Sheet({
  title,
  onClose,
  onBack,
  footer,
  children,
  locked = false,
}: {
  title: string;
  onClose: () => void;
  onBack?: () => void;
  footer?: ReactNode;
  children: ReactNode;
  /** While something can't be interrupted, the backdrop stops closing the sheet. */
  locked?: boolean;
}) {
  const { kb, maxH } = useKeyboardInset();

  // The feed behind the sheet must not scroll with it.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: "rgba(0,0,0,0.72)", backdropFilter: "blur(2px)", paddingBottom: kb }}
      onClick={locked ? undefined : onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-[440px] rounded-t-[22px] sm:rounded-[22px] flex flex-col overflow-hidden"
        style={{
          background: v("card"),
          border: `1px solid ${v("line")}`,
          color: v("ink"),
          maxHeight: maxH ?? "92dvh",
          boxShadow: "0 -12px 40px rgba(0,0,0,0.45)",
        }}
      >
        <div className="sm:hidden flex justify-center pt-2">
          <span className="h-1 w-9 rounded-full" style={{ background: "rgba(255,255,255,0.14)" }} />
        </div>
        <div className="flex items-center gap-1 px-2.5 h-12 shrink-0">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back"
              className="h-10 w-10 -ml-0.5 flex items-center justify-center rounded-xl active:bg-white/5"
              style={{ color: v("muted") }}
            >
              <IconBack className="w-5 h-5" />
            </button>
          ) : (
            <span className="w-2.5" />
          )}
          <div className="flex-1 min-w-0 text-[15px] font-semibold truncate">{title}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="h-10 w-10 flex items-center justify-center rounded-xl active:bg-white/5"
            style={{ color: v("muted") }}
          >
            <IconX className="w-[18px] h-[18px]" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-5">{children}</div>
        {footer && (
          <div
            className="shrink-0 px-5 pt-3"
            style={{
              borderTop: `1px solid ${v("line")}`,
              paddingBottom: "max(14px, env(safe-area-inset-bottom))",
              background: v("card"),
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function Label({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-2 px-0.5">
      <span className="text-[10.5px] font-semibold uppercase" style={{ color: v("quiet"), letterSpacing: "0.14em" }}>
        {children}
      </span>
      {right}
    </div>
  );
}

export function Notice({ tone, children, icon = true }: { tone: Tone; children: ReactNode; icon?: boolean }) {
  const t = TONE[tone];
  return (
    <div
      className="flex items-start gap-2.5 rounded-xl px-3 py-2.5 text-[12.5px] leading-snug"
      style={{ background: t.bg, border: `1px solid ${t.line}`, color: t.fg }}
    >
      {icon && (tone === "ok" ? <IconCheck className="w-4 h-4 mt-px shrink-0" /> : <IconAlert className="w-4 h-4 mt-px shrink-0" />)}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  busy,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className="w-full min-h-[50px] rounded-2xl px-4 py-2.5 flex items-center justify-center gap-2.5 text-[15px] font-semibold transition active:scale-[0.99] disabled:active:scale-100"
      style={{
        background: v("accent"),
        color: "#1a0f00",
        opacity: disabled && !busy ? 0.45 : 1,
      }}
    >
      {busy && <Spinner size={16} color="#1a0f00" />}
      {children}
    </button>
  );
}

export function SecondaryButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full min-h-[46px] rounded-2xl px-4 text-[14px] font-medium transition active:scale-[0.99]"
      style={{ background: v("bg-2"), border: `1px solid ${v("line")}`, color: v("ink") }}
    >
      {children}
    </button>
  );
}

export function GhostButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full py-2.5 text-[13px] font-medium rounded-xl active:bg-white/5"
      style={{ color: v("muted") }}
    >
      {children}
    </button>
  );
}

export function SearchBox({
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (s: string) => void;
  placeholder: string;
  autoFocus?: boolean;
}) {
  return (
    <label
      className="flex items-center gap-2 rounded-xl px-3 h-11"
      style={{ background: v("bg-2"), border: `1px solid ${v("line")}` }}
    >
      <IconSearch className="w-4 h-4 shrink-0" style={{ color: v("quiet") }} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        enterKeyHint="search"
        className="flex-1 min-w-0 bg-transparent text-[15px] outline-none"
        style={{ color: v("ink") }}
      />
      {value && (
        <button type="button" onClick={() => onChange("")} aria-label="Clear" style={{ color: v("quiet") }}>
          <IconX className="w-4 h-4" />
        </button>
      )}
    </label>
  );
}

/* ------------------------------------------------------------ money input */

/** "$1,234.5" → 1234.5. Empty or junk → null. */
export function parseMoney(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, "");
  if (!cleaned || cleaned === "." || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? round2(n) : null;
}

/**
 * A dollar box that lets you type. The old one rendered String(number), so
 * "12." snapped back to "12" and a decimal could never be entered.
 */
export function MoneyInput({
  value,
  onChange,
  ariaLabel,
  className = "",
  style,
  autoFocus,
  onDone,
}: {
  value: number;
  onChange: (n: number) => void;
  ariaLabel: string;
  className?: string;
  style?: CSSProperties;
  autoFocus?: boolean;
  onDone?: () => void;
}) {
  // null = not being typed in, so the box shows the live value (a rebalance,
  // a new total) without an effect copying it into state.
  const [draft, setDraft] = useState<string | null>(null);
  const focused = draft !== null;

  return (
    <label
      className={`flex items-center rounded-xl px-2.5 ${className}`}
      style={{ background: v("card"), border: `1px solid ${focused ? v("accent") : v("line")}`, ...style }}
    >
      <span className="text-[13px] mr-0.5" style={{ color: v("quiet") }}>$</span>
      <input
        value={draft ?? value.toFixed(2)}
        inputMode="decimal"
        enterKeyHint="done"
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        onFocus={(e) => {
          setDraft(value.toFixed(2));
          e.currentTarget.select();
        }}
        onBlur={() => {
          setDraft(null);
          onDone?.();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        onChange={(e) => {
          const text = e.target.value.replace(/[^0-9.,$]/g, "");
          setDraft(text);
          const n = parseMoney(text);
          if (n !== null) onChange(n);
        }}
        className="w-full min-w-0 bg-transparent py-2 text-right text-[15px] font-medium tabular-nums outline-none"
        style={{ color: v("ink") }}
      />
    </label>
  );
}

/* ----------------------------------------------------------- photo viewer */

export function PhotoViewer({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col"
      style={{ background: "rgba(0,0,0,0.94)" }}
      onClick={onClose}
    >
      <div className="flex justify-end p-3 shrink-0">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close photo"
          className="h-11 w-11 flex items-center justify-center rounded-full"
          style={{ background: "rgba(255,255,255,0.10)", color: "#fff" }}
        >
          <IconX className="w-5 h-5" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto flex items-start justify-center px-3 pb-6">
        {/* eslint-disable-next-line @next/next/no-img-element -- signed / local object URL */}
        <img src={src} alt="Receipt photo" className="max-w-full h-auto rounded-lg" onClick={(e) => e.stopPropagation()} />
      </div>
    </div>
  );
}

export function Thumb({ src, onOpen, size = 56 }: { src: string | null; onOpen?: () => void; size?: number }) {
  if (!src) {
    return (
      <span
        className="shrink-0 flex items-center justify-center rounded-lg"
        style={{ width: size, height: size * 1.25, background: v("bg-2"), border: `1px solid ${v("line")}`, color: v("quiet") }}
      >
        <IconReceipt className="w-5 h-5" />
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="View the receipt photo"
      className="shrink-0 overflow-hidden rounded-lg active:scale-[0.97] transition"
      style={{ width: size, height: size * 1.25, border: `1px solid ${v("line")}`, background: v("bg-2") }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- signed / local object URL */}
      <img src={src} alt="" className="w-full h-full object-cover" />
    </button>
  );
}
