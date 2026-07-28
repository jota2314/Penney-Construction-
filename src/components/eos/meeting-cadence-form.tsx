"use client";

import { useState, useTransition } from "react";
import { Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveMeetingCadence } from "@/lib/actions/eos-vto";

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const UNSET = "unset";

export function MeetingCadenceForm({
  meetingDay,
  meetingTime,
}: {
  meetingDay: number | null;
  meetingTime: string | null;
}) {
  const [day, setDay] = useState(
    meetingDay === null ? UNSET : String(meetingDay),
  );
  const [time, setTime] = useState(meetingTime?.slice(0, 5) ?? "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await saveMeetingCadence({
        meetingDay: day === UNSET ? null : Number(day),
        meetingTime: time || null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border p-4">
      <div className="space-y-1.5">
        <Label htmlFor="l10-day" className="text-xs">
          L10 day
        </Label>
        <Select value={day} onValueChange={setDay}>
          <SelectTrigger id="l10-day" className="w-[150px]">
            <SelectValue placeholder="Not set" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNSET}>Not set</SelectItem>
            {DAYS.map((name, index) => (
              <SelectItem key={name} value={String(index)}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="l10-time" className="text-xs">
          Time
        </Label>
        <Input
          id="l10-time"
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className="w-[130px]"
        />
      </div>

      <Button variant="secondary" onClick={save} disabled={pending}>
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {saved && !pending && <Check className="mr-2 h-4 w-4 text-emerald-500" />}
        Save
      </Button>

      <p className="w-full text-xs text-muted-foreground">
        Same day, same time, same agenda, every week — that is what makes the
        Level 10 work.
      </p>
      {error && <p className="w-full text-sm text-red-500">{error}</p>}
    </div>
  );
}
