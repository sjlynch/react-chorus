/**
 * Default per-message timestamp formatter. Mirrors the conversation-list
 * `defaultFormatTimestamp` approach: locale-aware `Intl.DateTimeFormat` with a
 * `toLocaleTimeString` fallback, and the raw string echoed back for unparseable
 * input. Messages show the time of day; pass `formatTimestamp` to <Chorus> to
 * override (for example to add the date or a relative format).
 */
export function defaultFormatMessageTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;

  try {
    return new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(date);
  } catch {
    return date.toLocaleTimeString();
  }
}
