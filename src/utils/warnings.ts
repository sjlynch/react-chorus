import { isChorusDevMode } from './devMode';

const warnedKeys = new Set<string>();

export function warnInDev(message: string, ...args: unknown[]): void {
  if (!isChorusDevMode()) return;
  console.warn(message, ...args);
}

export function warnOnceInDev(key: string, message: string, ...args: unknown[]): void {
  if (!isChorusDevMode() || warnedKeys.has(key)) return;
  warnedKeys.add(key);
  console.warn(message, ...args);
}
