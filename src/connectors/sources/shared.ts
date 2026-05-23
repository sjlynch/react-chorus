import type { MessageSource, MessageSourceType } from '../../types';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function stringFrom(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function numberFrom(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function recordFrom(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

export function withDefinedMetadata(entries: Record<string, unknown>): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function normalizeSourceType(value: unknown, fallback: MessageSourceType = 'unknown'): MessageSourceType {
  const raw = stringFrom(value)?.toLowerCase();
  if (!raw) return fallback;
  if (raw.includes('url') || raw === 'web') return 'url';
  if (raw.includes('document') || raw === 'doc') return 'document';
  if (raw.includes('file') || raw === 'container_file_citation' || raw === 'file_citation' || raw === 'file_path') return 'file';
  return fallback;
}

export function sourceHasRenderableData(source: MessageSource): boolean {
  // An id-only annotation is useful for provider bookkeeping but not for the
  // transcript: rendering/exporting a lone opaque id looks like protocol noise.
  return Boolean(source.url || source.title || source.snippet);
}

export function buildSource(source: MessageSource): MessageSource | null {
  return sourceHasRenderableData(source) ? source : null;
}
