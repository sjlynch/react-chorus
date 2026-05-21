export interface WeatherFixture {
  location: string;
  temperature_c: number;
  condition: string;
  precipitation_mm: number;
  wind_kmh: number;
}

export interface BasicWeatherFixture {
  location: string;
  temperature_c: number;
  condition: string;
  humidity: number;
  wind_kmh: number;
  wind_direction: string;
}

export const WEATHER_FIXTURES: Record<string, WeatherFixture> = {
  tokyo: { location: 'Tokyo', temperature_c: 22, condition: 'Partly cloudy', precipitation_mm: 0, wind_kmh: 12 },
  paris: { location: 'Paris', temperature_c: 17, condition: 'Light rain', precipitation_mm: 3.4, wind_kmh: 18 },
  london: { location: 'London', temperature_c: 14, condition: 'Overcast', precipitation_mm: 1.2, wind_kmh: 22 },
  'san francisco': { location: 'San Francisco', temperature_c: 18, condition: 'Foggy', precipitation_mm: 0, wind_kmh: 14 },
  'new york': { location: 'New York', temperature_c: 26, condition: 'Sunny', precipitation_mm: 0, wind_kmh: 9 },
};

const BASIC_WEATHER_FIXTURE = {
  temperature_c: 22,
  condition: 'Partly cloudy',
  humidity: 0.58,
  wind_kmh: 12,
  wind_direction: 'E',
} as const;

export function makeBasicWeatherFixture(location: string): BasicWeatherFixture {
  return {
    location,
    ...BASIC_WEATHER_FIXTURE,
  };
}

export function lookupWeather(location: string): WeatherFixture {
  const key = location.trim().toLowerCase();
  const fixture = WEATHER_FIXTURES[key];
  if (fixture) return fixture;
  // Deterministic fallback so unknown cities still produce coherent output.
  const hash = Array.from(key).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return {
    location: location.trim() || 'Unknown',
    temperature_c: 12 + (hash % 18),
    condition: hash % 2 === 0 ? 'Partly cloudy' : 'Clear',
    precipitation_mm: hash % 5 === 0 ? 2.1 : 0,
    wind_kmh: 6 + (hash % 14),
  };
}
