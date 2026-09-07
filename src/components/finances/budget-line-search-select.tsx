"use client";

import { useId, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import type { CaptureBudgetLine } from "@/lib/actions/field-capture";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

export function BudgetLineSearchSelect({
  lines, value, onChange, loading = false, disabled = false,
  placeholder = "Unassigned line", className,
}: {
  lines: CaptureBudgetLine[];
  value: string;
  onChange: (id: string) => void;
  loading?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const selected = lines.find((line) => line.id === value);
  const label = disabled ? "Choose a job first" : loading ? "Loading lines…"
    : selected?.description ?? (lines.length ? placeholder : "No budget lines");

  function pick(id: string) {
    onChange(id);
    setOpen(false);
  }

  return (
    <Popover open={open && !disabled && !loading} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-label={`Budget line: ${label}`}
          aria-expanded={open && !disabled && !loading}
          aria-controls={listId}
          disabled={disabled || loading}
          className={cn("flex min-h-11 sm:min-h-8 min-w-0 items-center justify-between gap-2 rounded-lg border bg-background px-2 py-1 text-left text-xs hover:border-amber-500/40 disabled:opacity-50", className)}
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" collisionPadding={12} className="w-[min(24rem,calc(100vw-24px))] overflow-hidden p-0">
        <Command filter={(_value, search, keywords) => {
          const text = (keywords ?? []).join(" ").toLowerCase().replace(/[_·#-]/g, " ");
          return search.toLowerCase().replace(/[_·#-]/g, " ").trim().split(/\s+/).every((word) => text.includes(word)) ? 1 : 0;
        }}>
          <CommandInput aria-label="Search budget lines" placeholder="Search line items or trades…" className="text-base sm:text-sm" />
          <CommandList id={listId} className="max-h-[min(300px,40dvh)] overscroll-contain">
            <CommandEmpty>No matching line items. Try another name or trade.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="unassigned" keywords={["Unassigned line"]} onSelect={() => pick("")} className="min-h-11">
                <Check className={cn("size-4", value ? "invisible" : "text-amber-500")} />
                Unassigned line
              </CommandItem>
              {lines.map((line) => (
                <CommandItem key={line.id} value={line.id} keywords={[line.description, line.trade ?? ""]} onSelect={() => pick(line.id)} className="min-h-11 items-start py-2.5">
                  <Check className={cn("mt-0.5 size-4", value === line.id ? "text-amber-500" : "invisible")} />
                  <span className="min-w-0 whitespace-normal break-words">
                    <span className="block">{line.description}</span>
                    {line.trade && <span className="block text-xs text-muted-foreground">{line.trade.replace(/_/g, " ")}</span>}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
