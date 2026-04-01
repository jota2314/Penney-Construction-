"use server";

// North Shore MA coordinates (Beverly/Salem area)
const LAT = 42.56;
const LON = -70.87;

export interface WeatherData {
  temp: number; // Fahrenheit
  code: number; // WMO weather code
  label: string;
  emoji: string;
  motivation: string;
}

// WMO Weather interpretation codes → labels + emoji
const WEATHER_MAP: Record<number, { label: string; emoji: string }> = {
  0: { label: "Clear sky", emoji: "☀️" },
  1: { label: "Mostly clear", emoji: "🌤️" },
  2: { label: "Partly cloudy", emoji: "⛅" },
  3: { label: "Overcast", emoji: "☁️" },
  45: { label: "Foggy", emoji: "🌫️" },
  48: { label: "Icy fog", emoji: "🌫️" },
  51: { label: "Light drizzle", emoji: "🌦️" },
  53: { label: "Drizzle", emoji: "🌦️" },
  55: { label: "Heavy drizzle", emoji: "🌧️" },
  56: { label: "Freezing drizzle", emoji: "🌧️" },
  57: { label: "Heavy freezing drizzle", emoji: "🌧️" },
  61: { label: "Light rain", emoji: "🌧️" },
  63: { label: "Rain", emoji: "🌧️" },
  65: { label: "Heavy rain", emoji: "🌧️" },
  66: { label: "Freezing rain", emoji: "🧊" },
  67: { label: "Heavy freezing rain", emoji: "🧊" },
  71: { label: "Light snow", emoji: "🌨️" },
  73: { label: "Snow", emoji: "❄️" },
  75: { label: "Heavy snow", emoji: "❄️" },
  77: { label: "Snow grains", emoji: "❄️" },
  80: { label: "Light showers", emoji: "🌦️" },
  81: { label: "Showers", emoji: "🌧️" },
  82: { label: "Heavy showers", emoji: "🌧️" },
  85: { label: "Snow showers", emoji: "🌨️" },
  86: { label: "Heavy snow showers", emoji: "🌨️" },
  95: { label: "Thunderstorm", emoji: "⛈️" },
  96: { label: "Thunderstorm + hail", emoji: "⛈️" },
  99: { label: "Thunderstorm + heavy hail", emoji: "⛈️" },
};

// Motivational messages grouped by weather type
const MOTIVATIONS = {
  sunny: [
    "Subs are on site, crew's in motion — lock in every detail today.",
    "Great day for walkthroughs. Get out there and close something.",
    "Clear skies mean no excuses. Push that permit through.",
    "Framers love this weather. Check in on your active jobs.",
    "Perfect conditions for concrete, roofing, and winning bids.",
    "Your competition is stuck in the office. Get boots on the ground.",
    "Sunshine and signed contracts — that's what today's about.",
    "Ideal day to schedule those client walkthroughs you've been putting off.",
    "Weather's on your side. Line up tomorrow's deliveries today.",
    "The best GCs make hay when the sun shines. Go get it.",
  ],
  cloudy: [
    "Cool and overcast — the crew can work all day without slowing down.",
    "Perfect estimating weather. Dial in those numbers.",
    "No rain in the forecast — push for progress on every open job.",
    "Cloudy days keep the painters happy. Check on those finish crews.",
    "Good conditions to pour, frame, or close a deal. Pick one.",
    "Quiet weather, loud results. Make the most of it.",
    "Your subs won't complain about this weather. Hold them to schedule.",
    "Overcast and productive. Time to follow up on every open quote.",
    "No weather delays on the horizon. Tighten up that schedule.",
    "The kind of day where real contractors separate from the rest.",
  ],
  rainy: [
    "Rain day — review every open estimate and sharpen your numbers.",
    "Jobsite's wet but your pipeline doesn't have to be. Send those proposals.",
    "Use this downtime to call subs and lock in pricing before it changes.",
    "Perfect day to reconcile budgets and chase down change orders.",
    "Rain pushes the schedule — update your clients before they ask.",
    "Catch up on permit applications while the site dries out.",
    "Your office work today funds your field work tomorrow. Get after it.",
    "Rain day = bid day. Find the next three projects worth chasing.",
    "Follow up on every unanswered email. They're money sitting there.",
    "The GCs who prep on rain days win on build days. That's you.",
  ],
  snow: [
    "Snow on the North Shore — review job costs and plan spring starts.",
    "Frozen ground means frozen schedules. Use today to get 2 weeks ahead.",
    "Snow day: update your sub list, check insurance certs, clean the pipeline.",
    "New England winters build tougher contractors. Sharpen the saw today.",
    "Perfect day to build out that estimate you've been putting off.",
    "Snow shuts down sites but opens up planning time. Don't waste it.",
    "Call your material suppliers — lock spring pricing while everyone sleeps.",
    "The thaw is coming. Have every job package ready to roll when it does.",
    "Winter is when smart GCs line up their entire spring backlog.",
    "Your crew's home but your business doesn't stop. Plan the next move.",
  ],
  storm: [
    "Storm day — make sure every job site is secured and buttoned up.",
    "Check on your crews, check on your subs, then check your numbers.",
    "Wild weather outside, calm focus inside. Tackle the hard stuff today.",
    "Good day to review contracts and make sure your scope is airtight.",
    "Storm means delays — communicate proactively with every client today.",
    "Use the downtime to negotiate better pricing with your suppliers.",
    "The storm will pass. Make sure you're ready to hit the ground running.",
    "Rough weather builds rough contractors. You've seen worse. Keep going.",
    "Today's mess is tomorrow's opportunity. Line up the recovery plan now.",
    "Every New England GC knows — you don't control the weather, just the hustle.",
  ],
};

function getWeatherCategory(code: number): keyof typeof MOTIVATIONS {
  if (code <= 1) return "sunny";
  if (code <= 3 || code === 45 || code === 48) return "cloudy";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rainy";
  if (code >= 71 && code <= 77 || code >= 85 && code <= 86) return "snow";
  return "storm";
}

function getDailyMotivation(code: number): string {
  const category = getWeatherCategory(code);
  const messages = MOTIVATIONS[category];
  // Rotate based on day of year so it changes daily
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((now.getTime() - start.getTime()) / 86400000);
  return messages[dayOfYear % messages.length];
}

export async function getWeather(): Promise<WeatherData | null> {
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=temperature_2m,weather_code&temperature_unit=fahrenheit&timezone=America/New_York`,
      { next: { revalidate: 1800 } } // Cache for 30 minutes
    );

    if (!res.ok) return null;

    const data = await res.json();
    const temp = Math.round(data.current.temperature_2m);
    const code = data.current.weather_code;
    const mapped = WEATHER_MAP[code] || { label: "Unknown", emoji: "🌡️" };

    return {
      temp,
      code,
      label: mapped.label,
      emoji: mapped.emoji,
      motivation: getDailyMotivation(code),
    };
  } catch {
    return null;
  }
}
