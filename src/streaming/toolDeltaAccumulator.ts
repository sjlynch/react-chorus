import type { ConnectorToolDelta } from '../connectors/types';

function hasOwn(value: object, key: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function tryParseJSON(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeToolValue(previous: unknown, next: unknown) {
  if (typeof next === 'string') {
    const combined = typeof previous === 'string' ? previous + next : next;
    return tryParseJSON(combined);
  }

  if (isRecord(previous) && isRecord(next)) return { ...previous, ...next };
  return next;
}

export function createToolDeltaAccumulator() {
  const pending = new Map<string, ConnectorToolDelta>();

  return (delta: ConnectorToolDelta): ConnectorToolDelta => {
    const current = pending.get(delta.id) ?? { id: delta.id };
    const next: ConnectorToolDelta = { ...current };

    if (delta.name) next.name = delta.name;
    if (delta.provider) next.provider = delta.provider;
    if (delta.providerId) next.providerId = delta.providerId;
    if (delta.generated !== undefined) next.generated = delta.generated;
    else if (delta.providerId && next.generated) next.generated = false;
    if (hasOwn(delta, 'input')) next.input = mergeToolValue(current.input, delta.input);
    if (hasOwn(delta, 'output')) next.output = mergeToolValue(current.output, delta.output);

    pending.set(delta.id, next);
    return next;
  };
}
