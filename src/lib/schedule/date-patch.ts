export interface ScheduleDateEdit {
  start_date?: string;
  end_date?: string;
  is_manually_scheduled?: boolean;
}

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

/** An office date edit is a forecast decision, never a replacement baseline. */
export function scheduleDatePatch(
  input: ScheduleDateEdit,
  before: { start_date: string | null; end_date: string | null },
): ScheduleDateEdit {
  const patch: ScheduleDateEdit = {};
  if (input.start_date !== undefined) patch.start_date = input.start_date;
  if (input.end_date !== undefined) patch.end_date = input.end_date;
  const changed =
    (input.start_date !== undefined && input.start_date !== before.start_date) ||
    (input.end_date !== undefined && input.end_date !== before.end_date);
  // An explicit false is the deliberate return-to-forecast operation. Merely
  // saving notes with unchanged dates must not freeze a floating phase.
  if (input.is_manually_scheduled !== undefined) patch.is_manually_scheduled = input.is_manually_scheduled;
  else if (changed) patch.is_manually_scheduled = true;
  return patch;
}
