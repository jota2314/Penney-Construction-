export function slippedDates(phase: { start_date: string; end_date: string; status: string }, days: number, today: string) {
  if (!Number.isInteger(days) || days < 1 || phase.status === "completed" || phase.end_date < today) return null;
  const add = (date: string) => {
    const value = new Date(date + "T00:00:00Z");
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
  };
  return {
    // Once work has started, its start date is history, not a forecast.
    start_date: phase.status === "in_progress" || phase.start_date < today ? phase.start_date : add(phase.start_date),
    end_date: add(phase.end_date),
  };
}
