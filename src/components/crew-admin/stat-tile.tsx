import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatTileProps {
  /** Optional icon rendered above the value. */
  icon?: LucideIcon;
  /** Tailwind color class for the icon. */
  iconClassName?: string;
  /** The number/amount to show — kept on one line, never clipped. */
  value: string;
  /** Caption under the value. */
  label: string;
  /** Tailwind color class for the value. */
  valueClassName?: string;
}

/**
 * Font size that keeps `value` on one line inside the tile.
 *
 * `cqi` is a percent of the card's *content* width, so this adapts to whatever
 * the grid gives the tile instead of guessing at the viewport. ~0.7em is the
 * average glyph width of a bold digit/unit string (measured against the
 * system-sans fallback, which is wider than Geist — so this errs on the side of
 * fitting). Caps at 1.5rem so short values keep the original `text-2xl` look.
 */
function fluidValueSize(value: string): string {
  const chars = Math.max(value.length, 1);
  const cqi = Math.min(100 / (chars * 0.7), 40);
  return `clamp(0.75rem, ${cqi.toFixed(1)}cqi, 1.5rem)`;
}

/**
 * Summary tile for the crew-admin 3-up grids.
 *
 * Three of these share a phone-width row, where a fixed `text-2xl` made long
 * values like "$8,818.95" spill past the card edge and "240h 25m" wrap to two
 * lines. The value now scales down just enough to fit its own tile.
 */
export function StatTile({
  icon: Icon,
  iconClassName,
  value,
  label,
  valueClassName,
}: StatTileProps) {
  return (
    <Card className="@container px-2 py-3 text-center sm:px-3">
      {Icon ? (
        <Icon className={cn("h-4 w-4 mx-auto mb-1", iconClassName)} />
      ) : null}
      <p
        style={{ fontSize: fluidValueSize(value) }}
        className={cn(
          // `break-words` is the safety valve: if a value is still too wide at
          // the minimum size (tiny phone + six-figure total) it wraps instead of
          // spilling outside the card.
          "font-bold leading-tight tabular-nums break-words",
          valueClassName
        )}
      >
        {value}
      </p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </Card>
  );
}
