/** Legacy midnight-UTC values came from date-only inspection forms. Preserve
 * their calendar day; real timestamps are displayed in the job's Eastern zone. */
export function inspectionCompletionDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return null;
  if (/^\d{4}-\d{2}-\d{2}(?:T00:00:00(?:\.0+)?(?:Z|\+00:00))?$/.test(value)) return value.slice(0, 10);
  return instant.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}
