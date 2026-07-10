"use client";

import { useState } from "react";
import { Check, ChevronsUpDown, FolderKanban } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface ScheduleProjectOption {
  id: string;
  name: string;
  project_number?: string | null;
}

interface ProjectPickerProps {
  projects: ScheduleProjectOption[];
  value: string;
  onValueChange: (value: string) => void;
  allowAll?: boolean;
  placeholder?: string;
  className?: string;
}

export function ProjectPicker({
  projects,
  value,
  onValueChange,
  allowAll = false,
  placeholder = "Select a project",
  className,
}: ProjectPickerProps) {
  const [open, setOpen] = useState(false);
  const selected = projects.find((project) => project.id === value);
  const label = value === "all" ? "All Projects" : selected?.name ?? placeholder;

  function select(nextValue: string) {
    onValueChange(nextValue);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Choose project"
          className={cn("min-w-0 justify-between font-normal", className)}
        >
          <span className="flex min-w-0 items-center gap-2">
            <FolderKanban className="h-4 w-4 shrink-0 text-amber-500" />
            <span className="truncate">{label}</span>
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] min-w-[280px] p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder="Search name or project number..." />
          <CommandList className="max-h-[min(360px,55vh)]">
            <CommandEmpty>No matching projects.</CommandEmpty>
            <CommandGroup heading="Projects">
              {allowAll && (
                <CommandItem value="all projects" onSelect={() => select("all")}>
                  <Check
                    className={cn(
                      "h-4 w-4",
                      value === "all" ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span>All Projects</span>
                </CommandItem>
              )}
              {projects.map((project) => (
                <CommandItem
                  key={project.id}
                  value={`${project.name} ${project.project_number ?? ""}`}
                  onSelect={() => select(project.id)}
                  className="py-2.5"
                >
                  <Check
                    className={cn(
                      "h-4 w-4",
                      value === project.id ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {project.name}
                    </span>
                    {project.project_number && (
                      <span className="block text-xs text-muted-foreground">
                        {project.project_number}
                      </span>
                    )}
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
