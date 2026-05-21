export function normalizeTimestamp(value: Date | string | number): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return new Date(value).toISOString();
  return value;
}

export function getTimestamp(now: () => Date | string | number) {
  return normalizeTimestamp(now());
}
