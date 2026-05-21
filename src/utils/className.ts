/**
 * Joins class-name fragments into a single space-separated string, dropping any
 * falsy entry (`false`, `null`, `undefined`, `''`). This is the shared form of
 * the `[...].filter(Boolean).join(' ')` idiom used for conditional class-name
 * assembly across components.
 *
 * Internal helper — not part of the public API and not exported from the
 * package barrel.
 */
export function joinClasses(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
