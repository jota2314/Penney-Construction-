"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Calculator, HardHat } from "lucide-react";
import { setMode } from "@/lib/actions/mode";
import type { AppMode } from "@/types/auth";

const modes: { key: AppMode; label: string; description: string; icon: typeof Calculator }[] = [
  {
    key: "precon",
    label: "Pre-Construction",
    description: "CRM, estimates, bid requests, and proposals",
    icon: Calculator,
  },
  {
    key: "construction",
    label: "Construction",
    description: "Projects, schedule, employees, and vendors",
    icon: HardHat,
  },
];

export function ModeSelector() {
  const router = useRouter();
  const [loading, setLoading] = useState<AppMode | null>(null);

  async function handleSelect(mode: AppMode) {
    setLoading(mode);
    await setMode(mode);
    router.push("/dashboard");
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 w-full max-w-2xl">
      {modes.map((m) => (
        <button
          key={m.key}
          onClick={() => handleSelect(m.key)}
          disabled={loading !== null}
          className="group relative flex flex-col items-center gap-4 rounded-xl border-2 border-muted bg-card p-8 text-center transition-all hover:border-primary hover:shadow-lg disabled:opacity-60"
        >
          <div className="rounded-full bg-primary/10 p-4 transition-colors group-hover:bg-primary/20">
            <m.icon className="h-10 w-10 text-primary" />
          </div>
          <div>
            <h3 className="text-lg font-semibold">
              {loading === m.key ? "Loading..." : m.label}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {m.description}
            </p>
          </div>
        </button>
      ))}
    </div>
  );
}
