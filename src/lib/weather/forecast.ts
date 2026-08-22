import "server-only";

/**
 * Per-jobsite weather for the job board.
 *
 * Open-Meteo is free, keyless, and accepts a comma-separated list of
 * coordinates in ONE request, so all 49 geocoded jobs cost two fetches
 * (daily + hourly) rather than 98. Sites are snapped to a ~0.05° grid first,
 * which collapses the North Shore down to a handful of distinct cells —
 * Gloucester and Danvers stay separate, two jobs on the same street share a
 * reading.
 *
 * The board window runs 60 days forward; a forecast is only honest for about
 * 16. Days past the horizon return undefined and the ribbon renders blank
 * rather than printing a guess.
 *
 * See also `src/lib/actions/weather.ts` — the command-center's single
 * "current conditions" reading. Deliberately separate: that one is one
 * location and one moment, this one is many sites across many days.
 */

const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";
const TZ = "America/New_York";

/** Fallback when a project has no lat/long — Beverly, mid North Shore. */
export const NORTH_SHORE = { latitude: 42.56, longitude: -70.87 };

/** Days of daily forecast to request. Open-Meteo tops out at 16. */
export const FORECAST_DAYS = 16;
/** Days of hour-by-hour detail. Only today + tomorrow are ever displayed. */
const HOURLY_DAYS = 2;

/** ~0.05° ≈ 3.5 miles. Fine enough to separate towns, coarse enough to dedupe. */
const GRID = 0.05;

export interface DayWeather {
  date: string; // YYYY-MM-DD
  code: number;
  label: string;
  icon: string;
  high: number;
  low: number;
  /** 0-100. Open-Meteo's daily max probability. */
  precipChance: number;
  /** Inches. */
  precipTotal: number;
  /** mph. */
  windMax: number;
  /** True when the day is wet enough to move exterior work. */
  wet: boolean;
}

export interface HourWeather {
  /** Local hour, 0-23. */
  hour: number;
  date: string;
  code: number;
  icon: string;
  temp: number;
  precipChance: number;
  wet: boolean;
}

export interface SiteForecast {
  days: Map<string, DayWeather>;
  hours: HourWeather[];
}

/** Keyed by grid cell — see `siteKey`. */
export type ForecastIndex = Map<string, SiteForecast>;

// ── WMO code → label + icon ──────────────────────────────────────
// Same code table as lib/actions/weather.ts, condensed to the buckets the
// board actually distinguishes.

const CODES: Record<number, { label: string; icon: string }> = {
  0: { label: "Clear", icon: "☀" },
  1: { label: "Mostly clear", icon: "🌤" },
  2: { label: "Partly cloudy", icon: "⛅" },
  3: { label: "Overcast", icon: "☁" },
  45: { label: "Fog", icon: "🌫" },
  48: { label: "Icy fog", icon: "🌫" },
  51: { label: "Light drizzle", icon: "🌦" },
  53: { label: "Drizzle", icon: "🌦" },
  55: { label: "Heavy drizzle", icon: "🌧" },
  56: { label: "Freezing drizzle", icon: "🌧" },
  57: { label: "Freezing drizzle", icon: "🌧" },
  61: { label: "Light rain", icon: "🌦" },
  63: { label: "Rain", icon: "🌧" },
  65: { label: "Heavy rain", icon: "🌧" },
  66: { label: "Freezing rain", icon: "🧊" },
  67: { label: "Freezing rain", icon: "🧊" },
  71: { label: "Light snow", icon: "🌨" },
  73: { label: "Snow", icon: "❄" },
  75: { label: "Heavy snow", icon: "❄" },
  77: { label: "Snow grains", icon: "❄" },
  80: { label: "Light showers", icon: "🌦" },
  81: { label: "Showers", icon: "🌧" },
  82: { label: "Heavy showers", icon: "🌧" },
  85: { label: "Snow showers", icon: "🌨" },
  86: { label: "Snow showers", icon: "🌨" },
  95: { label: "Thunderstorm", icon: "⛈" },
  96: { label: "Thunderstorm", icon: "⛈" },
  99: { label: "Thunderstorm", icon: "⛈" },
};

function decode(code: number) {
  return CODES[code] ?? { label: "—", icon: "·" };
}

/** Codes that mean water is falling out of the sky. */
function isPrecip(code: number) {
  return (code >= 51 && code <= 67) || (code >= 71 && code <= 86) || code >= 95;
}

/**
 * "Wet" for scheduling purposes — not the same as "it might drizzle".
 * A 40% chance of a passing shower doesn't stop a crew; a half inch does.
 */
function isWetDay(code: number, precipChance: number, precipTotal: number) {
  if (precipTotal >= 0.1) return true;
  if (precipChance >= 55 && isPrecip(code)) return true;
  return code >= 71; // snow and storms always count
}

// ── Site keys ────────────────────────────────────────────────────

export interface SiteCoords {
  latitude: number | null;
  longitude: number | null;
}

function snap(n: number) {
  return Math.round(n / GRID) * GRID;
}

/**
 * Grid-cell key for a project's coordinates. Projects without coordinates
 * (2 of 51 today) fall back to the North Shore default so they still get a
 * ribbon instead of a hole.
 */
export function siteKey(site: SiteCoords | null | undefined): string {
  const lat = site?.latitude ?? NORTH_SHORE.latitude;
  const lon = site?.longitude ?? NORTH_SHORE.longitude;
  return `${snap(lat).toFixed(2)},${snap(lon).toFixed(2)}`;
}

function parseKey(key: string) {
  const [lat, lon] = key.split(",");
  return { lat: Number(lat), lon: Number(lon) };
}

// ── Fetch ────────────────────────────────────────────────────────

interface DailyBlock {
  time: string[];
  weather_code: number[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  precipitation_probability_max: (number | null)[];
  precipitation_sum: (number | null)[];
  wind_speed_10m_max: (number | null)[];
}

interface HourlyBlock {
  time: string[];
  weather_code: number[];
  temperature_2m: number[];
  precipitation_probability: (number | null)[];
}

interface MeteoResponse {
  daily?: DailyBlock;
  hourly?: HourlyBlock;
}

/** Open-Meteo returns a bare object for one location, an array for many. */
function asList(json: unknown): MeteoResponse[] {
  return Array.isArray(json) ? (json as MeteoResponse[]) : [json as MeteoResponse];
}

function buildDays(daily: DailyBlock | undefined): Map<string, DayWeather> {
  const out = new Map<string, DayWeather>();
  if (!daily?.time) return out;
  for (let i = 0; i < daily.time.length; i++) {
    const code = daily.weather_code[i] ?? 0;
    const precipChance = Math.round(daily.precipitation_probability_max?.[i] ?? 0);
    const precipTotal = daily.precipitation_sum?.[i] ?? 0;
    const { label, icon } = decode(code);
    out.set(daily.time[i], {
      date: daily.time[i],
      code,
      label,
      icon,
      high: Math.round(daily.temperature_2m_max[i]),
      low: Math.round(daily.temperature_2m_min[i]),
      precipChance,
      precipTotal: Math.round(precipTotal * 100) / 100,
      windMax: Math.round(daily.wind_speed_10m_max?.[i] ?? 0),
      wet: isWetDay(code, precipChance, precipTotal),
    });
  }
  return out;
}

function buildHours(hourly: HourlyBlock | undefined): HourWeather[] {
  if (!hourly?.time) return [];
  return hourly.time.map((t, i) => {
    const code = hourly.weather_code[i] ?? 0;
    const precipChance = Math.round(hourly.precipitation_probability?.[i] ?? 0);
    const [date, clock] = t.split("T");
    return {
      date,
      hour: Number(clock.slice(0, 2)),
      code,
      icon: decode(code).icon,
      temp: Math.round(hourly.temperature_2m[i]),
      precipChance,
      wet: precipChance >= 55 && isPrecip(code),
    };
  });
}

/**
 * One daily + one hourly request covering every distinct jobsite cell.
 *
 * Never throws: a weather outage must not take the board down, so a failure
 * returns an empty index and every ribbon cell renders blank.
 */
export async function getSiteForecasts(sites: SiteCoords[]): Promise<ForecastIndex> {
  const index: ForecastIndex = new Map();

  const keys = Array.from(new Set(sites.map(siteKey)));
  if (keys.length === 0) return index;

  const coords = keys.map(parseKey);
  const lats = coords.map((c) => c.lat.toFixed(2)).join(",");
  const lons = coords.map((c) => c.lon.toFixed(2)).join(",");
  const base =
    `${OPEN_METEO}?latitude=${lats}&longitude=${lons}` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=${TZ}`;

  try {
    const [dailyRes, hourlyRes] = await Promise.all([
      fetch(
        `${base}&forecast_days=${FORECAST_DAYS}` +
          `&daily=weather_code,temperature_2m_max,temperature_2m_min,` +
          `precipitation_probability_max,precipitation_sum,wind_speed_10m_max`,
        { next: { revalidate: 1800 } },
      ),
      fetch(
        `${base}&forecast_days=${HOURLY_DAYS}` +
          `&hourly=weather_code,temperature_2m,precipitation_probability`,
        { next: { revalidate: 1800 } },
      ),
    ]);

    const daily = dailyRes.ok ? asList(await dailyRes.json()) : [];
    const hourly = hourlyRes.ok ? asList(await hourlyRes.json()) : [];

    keys.forEach((key, i) => {
      index.set(key, {
        days: buildDays(daily[i]?.daily),
        hours: buildHours(hourly[i]?.hourly),
      });
    });
  } catch (error) {
    console.error("[weather/forecast] read failed, board renders without it:", error);
  }

  return index;
}

// ── Weather-sensitive work ───────────────────────────────────────

/**
 * Phase-name fragments that mean the work happens outside. Matched against
 * `schedule_phases.name`, which is free text Jorge types — so this is a
 * keyword sweep, not a taxonomy. Interior trades (tile, cabinet, drywall)
 * are deliberately absent: rain doesn't move them.
 */
const EXTERIOR_KEYWORDS = [
  "roof",
  "reroof",
  "shingle",
  "siding",
  "clapboard",
  "trim",
  "deck",
  "porch",
  "railing",
  "concrete",
  "footing",
  "foundation",
  "slab",
  "frost wall",
  "excavat",
  "grading",
  "backfill",
  "drywell",
  "gutter",
  "masonry",
  "chimney",
  "exterior paint",
  "stain",
  "window",
  "skylight",
  "flashing",
  "copper",
  "landscap",
  "paver",
  "crane",
  "tear-off",
  "tear off",
  "demo",
];

export function isExteriorPhase(name: string | null | undefined): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  return EXTERIOR_KEYWORDS.some((k) => n.includes(k));
}

export interface WeatherRisk {
  date: string;
  reason: string;
}

/**
 * Why a given exterior phase is at risk on a given day — or null if it isn't.
 * Concrete and paint care about cold; roofing cares about wind; everything
 * outside cares about rain.
 */
export function phaseRiskOn(
  phaseName: string,
  day: DayWeather | undefined,
): WeatherRisk | null {
  if (!day || !isExteriorPhase(phaseName)) return null;
  const n = phaseName.toLowerCase();

  if (day.wet) {
    const how = day.code >= 71 && day.code <= 86 ? "Snow" : "Rain";
    return {
      date: day.date,
      reason: `${how} ${day.precipChance}%${day.precipTotal >= 0.1 ? ` · ${day.precipTotal}"` : ""}`,
    };
  }
  const cold = /concrete|footing|foundation|slab|frost wall|paint|stain|masonry|paver/.test(n);
  if (cold && day.low <= 35) {
    return { date: day.date, reason: `Low ${day.low}° — too cold to pour or coat` };
  }
  const windy = /roof|shingle|siding|crane|tear-?off|flashing|copper/.test(n);
  if (windy && day.windMax >= 25) {
    return { date: day.date, reason: `Wind ${day.windMax} mph` };
  }
  return null;
}
