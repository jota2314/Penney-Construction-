"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Calculator, HardHat } from "lucide-react";
import { setMode } from "@/lib/actions/mode";
import type { AppMode } from "@/types/auth";

const options: { key: AppMode; label: string; icon: typeof Calculator }[] = [
  { key: "precon", label: "Pre-Con", icon: Calculator },
  { key: "construction", label: "Build", icon: HardHat },
];

export function ModeToggle({ mode }: { mode: AppMode }) {
  const router = useRouter();
  const [current, setCurrent] = useState(mode);

  async function handleSwitch(next: AppMode) {
    if (next === current) return;
    setCurrent(next);
    await setMode(next);
    router.refresh();
  }

  return (
    <>
      {/* Expanded sidebar — full toggle */}
      <div className="group-data-[collapsible=icon]:hidden px-3 py-2">
        <div className="flex rounded-lg bg-muted/60 p-1">
          {options.map((opt) => {
            const active = current === opt.key;
            return (
              <button
                key={opt.key}
                onClick={() => handleSwitch(opt.key)}
                className={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-all ${
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <opt.icon className={`h-4 w-4 ${active ? "text-primary" : ""}`} />
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Collapsed sidebar — icon only toggle */}
      <div className="hidden group-data-[collapsible=icon]:flex flex-col items-center gap-1 py-2">
        {options.map((opt) => {
          const active = current === opt.key;
          return (
            <button
              key={opt.key}
              onClick={() => handleSwitch(opt.key)}
              title={opt.label}
              className={`rounded-md p-1.5 transition-all ${
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              <opt.icon className="h-4 w-4" />
            </button>
          );
        })}
      </div>
    </>
  );
}
