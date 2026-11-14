"use client";

import { useFormStatus } from "react-dom";
import { CalendarPlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Submit button for the Connect Google Calendar form. Shows progress while Google opens. */
export function CalendarConnectButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending} className="min-h-11 w-full sm:w-auto">
    {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <CalendarPlus aria-hidden="true" />}
    {pending ? "Opening Google…" : label}
  </Button>;
}
