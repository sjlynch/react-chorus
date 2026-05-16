import type { Message } from '../types';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function hasOwn(value: object, key: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function metadataRecord(message: Message<unknown>) {
  return isRecord(message.metadata) ? message.metadata : undefined;
}

function nestedRecord(record: Record<string, unknown> | undefined, key: string) {
  const nested = record?.[key];
  return isRecord(nested) ? nested : undefined;
}

export function metadataString(
  message: Message<unknown>,
  providerKey: string,
  providerKeys: string[],
  rootKeys: string[],
) {
  const metadata = metadataRecord(message);
  const provider = nestedRecord(metadata, providerKey);

  for (const key of providerKeys) {
    const value = nonEmptyString(provider?.[key]);
    if (value) return value;
  }

  for (const key of rootKeys) {
    const value = nonEmptyString(metadata?.[key]);
    if (value) return value;
  }

  return null;
}

export function metadataArray(
  message: Message<unknown>,
  providerKey: string,
  providerKeys: string[],
  rootKeys: string[],
) {
  const metadata = metadataRecord(message);
  const provider = nestedRecord(metadata, providerKey);

  for (const key of providerKeys) {
    const value = provider?.[key];
    if (Array.isArray(value)) return value;
  }

  for (const key of rootKeys) {
    const value = metadata?.[key];
    if (Array.isArray(value)) return value;
  }

  return null;
}
