"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { CrewProjectOption } from "@/lib/board/crew-board-data";

const GROUPS: { key: CrewProjectOption["group"]; heading: string }[] = [
  { key: "running", heading: "On site — crew scheduled" },
  { key: "active", heading: "Active jobs" },
  { key: "contracted", heading: "Contracted — not started" },
];

/**
 * Type-to-filter over name and job number, with the running jobs first.
 *
 * The plain select this replaced put twenty-eight jobs in one alphabetical
 * list, so finding the three Jorge is actually moving people between meant
 * scrolling past the shop and the office.
 */
export function JobPicker({
  projects,
  value,
  onChange,
  compact,
  placeholder = "Pick a job",
  id,
}: {
  projects: CrewProjectOption[];
  value: string;
  onChange: (id: string) => void;
  compact?: boolean;
  placeholder?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = projects.find((p) => p.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full min-w-0 justify-between font-normal", compact && "h-8 text-xs")}
        >
          {selected ? (
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: selected.color }} />
              <span className="truncate">{selected.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{selected.shortNumber}</span>
            </span>
          ) : (
            <span className="truncate text-muted-foreground">{placeholder}</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[300px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Type a job name or number…" />
          <CommandList className="max-h-[min(340px,55vh)]">
            <CommandEmpty>No job matches that.</CommandEmpty>
            {GROUPS.map(({ key, heading }) => {
              const rows = projects.filter((p) => p.group === key);
              if (rows.length === 0) return null;
              return (
                <CommandGroup key={key} heading={heading}>
                  {rows.map((p) => (
                    <CommandItem
                      key={p.id}
                      value={`${p.name} ${p.projectNumber} ${p.shortNumber}`}
                      onSelect={() => {
                        onChange(p.id);
                        setOpen(false);
                      }}
                    >
                      <Check className={cn("h-4 w-4 shrink-0", value === p.id ? "opacity-100" : "opacity-0")} />
                      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: p.color }} />
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{p.shortNumber}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
