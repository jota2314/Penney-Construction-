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
    "Perfect day to get it done — let's build something great.",
    "Sun's out, subs are rolling. Make it count.",
    "Clear skies, clear schedule. Let's crush it.",
    "Beautiful day on the North Shore. Time to move mountains.",
    "The sun doesn't wait and neither do we. Let's go.",
    "Great weather means great progress. Own this day.",
    "Nothing stops a Penney crew on a day like this.",
  ],
  cloudy: [
    "Overcast keeps it cool — perfect working weather.",
    "No glare, no sunburn. Just focus.",
    "Clouds keep the crew comfortable. Solid work day ahead.",
    "Grey sky, sharp mind. Let's get after it.",
    "Not every day needs sunshine to shine. You got this.",
    "Cool and steady. The best kind of build day.",
    "Clouds today, results tomorrow. Keep pushing.",
  ],
  rainy: [
    "Rain slows the site but not the office. Plan ahead today.",
    "Rainy days are for estimates, follow-ups, and getting organized.",
    "Let the rain handle the outside — you handle the deals.",
    "Wet weather, dry strategy. Use this time wisely.",
    "The rain will pass but your prep work will pay off.",
    "Indoor day — perfect for catching up on quotes and emails.",
    "Rain means the competition stops. You don't.",
  ],
  snow: [
    "Snow day on the North Shore — get ahead on paperwork.",
    "New England tough. A little snow won't slow us down.",
    "Snow on the ground, fire in the belly. Let's plan big.",
    "The jobsite waits but the office doesn't. Prep for the thaw.",
    "Winter builds character. And better estimates.",
    "Snow day = strategy day. Come back swinging tomorrow.",
    "Frozen ground, hot pipeline. Keep those deals moving.",
  ],
  storm: [
    "Storm day — batten down and handle business from HQ.",
    "Thunder outside, thunder inside. Let's get it done.",
    "Stay safe, stay sharp. The storm will pass.",
    "Wild weather, calm focus. Handle what you can control.",
    "Storms clear the air. Tomorrow will be even better.",
    "Let the thunder roll — you've got bigger things to build.",
    "Every storm runs out of rain. We never run out of drive.",
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
