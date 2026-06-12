/**
 * Maximum length of a single field shift, in hours. A worker who clocks in and
 * never clocks out has their log auto-closed at this many hours so the timer
 * never runs away and their hours stay sane. Lives in its own dependency-free
 * module so both server (cron) and client (live ticker) code can share it.
 */
export const MAX_SHIFT_HOURS = 12;
export const MAX_SHIFT_MS = MAX_SHIFT_HOURS * 3_600_000;
