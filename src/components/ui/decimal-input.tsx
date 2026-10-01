"use client";

import { forwardRef, useState, type InputHTMLAttributes } from "react";
import { parseMoney } from "@/lib/money";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange" | "type"> & {
  value: number | null | undefined;
  onValueChange: (value: number | null) => void;
  /** "money" rounds to the cent and accepts "$1,250.50"; "number" keeps what was typed (markup %, qty). */
  kind?: "money" | "number";
  /** Show an empty box instead of "0" when the value is zero. */
  blankZero?: boolean;
};

/**
 * A number box that lets you type what you mean. A controlled number input fed
 * `value || ""` blanks itself the moment you type "0" — so $0.75 could never
 * be entered — and loses a trailing "12." on re-render. This keeps the raw
 * text while focused and hands the parent a number to the cent.
 */
export const DecimalInput = forwardRef<HTMLInputElement, Props>(function DecimalInput(
  { value, onValueChange, kind = "money", blankZero = false, onFocus, onBlur, ...rest },
  ref,
) {
  const [draft, setDraft] = useState<string | null>(null);

  const display = (() => {
    if (value == null || !Number.isFinite(value)) return "";
    if (blankZero && value === 0) return "";
    if (kind === "money") return Number.isInteger(value) ? String(value) : value.toFixed(2);
    return String(value);
  })();

  return (
    <input
      ref={ref}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      {...rest}
      value={draft ?? display}
      onFocus={(e) => {
        setDraft(display);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setDraft(null);
        onBlur?.(e);
      }}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        if (text.trim() === "") {
          onValueChange(null);
          return;
        }
        const n = kind === "money" ? parseMoney(text) : Number(text.replace(/[,\s%]/g, ""));
        if (n !== null && Number.isFinite(n)) onValueChange(n);
      }}
    />
  );
});
