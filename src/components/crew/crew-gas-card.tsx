"use client";

import { useState } from "react";
import Image from "next/image";
import { ChevronRight, Fuel, Loader2, Sun, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/** One tap from every crew screen, including the warehouse runner's route. */
export function CrewGasCard() {
  const [imageState, setImageState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  return (
    <Dialog onOpenChange={() => setImageState("loading")}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex min-h-11 w-full items-center gap-2 border-t border-border/50 bg-amber-500/10 px-4 py-2 text-left text-sm text-amber-700 transition-colors hover:bg-amber-500/20 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-amber-500 dark:text-amber-400"
          aria-label="Gas — open BJ's card"
        >
          <Fuel className="size-5 shrink-0" aria-hidden="true" />
          <span className="font-semibold">Gas</span>
          <span className="text-xs">BJ&apos;s card</span>
          <ChevronRight className="ml-auto size-4" aria-hidden="true" />
        </button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        className="flex h-[100dvh] w-screen max-w-none flex-col gap-0 rounded-none border-0 bg-white p-0 text-slate-950 sm:max-w-none"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] [@media(max-height:500px)]:py-1">
          <div>
            <DialogTitle className="flex items-center gap-2">
              <Fuel className="size-5 text-amber-600" aria-hidden="true" />
              BJ&apos;s Gas
            </DialogTitle>
            <DialogDescription className="mt-1 text-slate-600 [@media(max-height:500px)]:sr-only">
              Show this barcode to the scanner.
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <button
              type="button"
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-950 hover:bg-slate-200 focus-visible:outline-2 focus-visible:outline-amber-600"
              aria-label="Close gas card"
            >
              <X className="size-6" aria-hidden="true" />
            </button>
          </DialogClose>
        </div>

        <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 py-4 [@media(max-height:500px)]:py-2">
          {imageState === "loading" && (
            <div role="status" className="absolute flex items-center gap-2 text-sm text-slate-600">
              <Loader2 className="size-5 animate-spin" aria-hidden="true" />
              Loading card…
            </div>
          )}
          {imageState === "error" ? (
            <div role="alert" className="space-y-4 px-4 text-center">
              <p>Couldn&apos;t load the card. Check your connection and try again.</p>
              <Button
                type="button"
                className="bg-amber-600 text-white hover:bg-amber-700"
                onClick={() => {
                  setImageState("loading");
                  setAttempt((value) => value + 1);
                }}
              >
                Try again
              </Button>
            </div>
          ) : (
            <Image
              key={attempt}
              src={`/api/crew/gas-card?attempt=${attempt}`}
              alt="BJ's gas membership barcode"
              width={1280}
              height={640}
              unoptimized
              loading="eager"
              className={`max-h-full w-full object-contain ${imageState === "ready" ? "opacity-100" : "opacity-0"}`}
              onLoad={() => setImageState("ready")}
              onError={() => setImageState("error")}
            />
          )}
        </div>

        <div className="shrink-0 space-y-1 border-t border-slate-200 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] text-center text-sm text-slate-600 [@media(max-height:500px)]:py-2">
          <p className="flex items-center justify-center gap-2 font-medium text-slate-800">
            <Sun className="size-4 shrink-0" aria-hidden="true" />
            Turn your screen brightness up.
          </p>
          <p className="[@media(max-height:500px)]:hidden">Turn your phone sideways for a larger barcode.</p>
          <p className="text-xs [@media(max-height:500px)]:hidden">Follow the pump instructions to finish.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
