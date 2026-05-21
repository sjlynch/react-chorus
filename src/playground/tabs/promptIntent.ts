import { WEATHER_FIXTURES } from './weatherFixtures';

/**
 * Substrings that select the in-band error demo. The list includes the words
 * of the shipped "Force a transport error" suggested-prompt chip ('transport
 * error' / 'force a transport') so clicking the chip actually reaches the
 * error path instead of falling through to a normal streamed reply.
 */
export function isErrorPrompt(prompt: string): boolean {
  const p = prompt.toLowerCase();
  return p.includes('force error')
    || p.includes('make this fail')
    || p.includes('trigger error')
    || p.includes('transport error')
    || p.includes('force a transport');
}

export function extractWeatherLocation(prompt: string, fallback = 'Tokyo'): string {
  return /weather\s+(?:in|at|for)\s+([a-zA-Z\s]+)/i.exec(prompt)?.[1]?.trim() || fallback;
}

export function extractWeatherCities(prompt: string): string[] {
  const matches: string[] = [];
  const lowerPrompt = prompt.toLowerCase();
  for (const fixtureKey of Object.keys(WEATHER_FIXTURES)) {
    const fixture = WEATHER_FIXTURES[fixtureKey];
    if (fixture && lowerPrompt.includes(fixtureKey)) matches.push(fixture.location);
  }
  if (matches.length === 0) {
    // "weather in X and Y" / "X and Y weather" / "weather for X, Y, Z" parsing.
    const m = /(?:in|for|between|of|at)\s+([A-Z][a-zA-Z\s]+?)(?:\s+(?:and|vs|versus|or|,)\s+([A-Z][a-zA-Z\s]+?))?(?:\s+and\s+([A-Z][a-zA-Z\s]+?))?[\s?.!]*$/.exec(prompt);
    if (m) {
      for (let i = 1; i <= 3; i++) {
        const city = m[i]?.trim();
        if (city) matches.push(city);
      }
    }
  }
  return matches.length > 0 ? matches : ['Tokyo', 'Paris'];
}
