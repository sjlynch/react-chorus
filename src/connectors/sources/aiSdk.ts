import type { MessageSource } from '../../types';
import { buildSource, isRecord, normalizeSourceType, stringFrom, withDefinedMetadata } from './shared';

export function sourceFromAiSdkUiFrame(obj: Record<string, unknown>): MessageSource | null {
  const type = stringFrom(obj.type);
  if (type !== 'source-url' && type !== 'source-document') return null;
  const isUrl = type === 'source-url';
  const metadata = withDefinedMetadata({
    provider: 'ai-sdk',
    mediaType: obj.mediaType,
    filename: obj.filename,
  });
  return buildSource({
    id: stringFrom(obj.sourceId) ?? stringFrom(obj.id),
    type: isUrl ? 'url' : 'document',
    title: stringFrom(obj.title) ?? stringFrom(obj.filename) ?? stringFrom(obj.name),
    url: stringFrom(obj.url),
    snippet: stringFrom(obj.snippet) ?? stringFrom(obj.text) ?? stringFrom(obj.content),
    metadata,
  });
}

export function sourceFromAiSdkDataStream(value: unknown): MessageSource | null {
  if (typeof value === 'string') {
    const isUrl = value.startsWith('http://') || value.startsWith('https://');
    return buildSource({
      type: isUrl ? 'url' : 'unknown',
      url: isUrl ? value : undefined,
      title: isUrl ? undefined : value,
    });
  }
  if (!isRecord(value)) return null;
  const sourceType = normalizeSourceType(value.sourceType ?? value.type, stringFrom(value.url) ? 'url' : 'document');
  const metadata = withDefinedMetadata({
    provider: 'ai-sdk',
    mediaType: value.mediaType,
    filename: value.filename,
    page: value.page,
  });
  return buildSource({
    id: stringFrom(value.sourceId) ?? stringFrom(value.id),
    type: sourceType,
    title: stringFrom(value.title) ?? stringFrom(value.filename) ?? stringFrom(value.name),
    url: stringFrom(value.url),
    snippet: stringFrom(value.snippet) ?? stringFrom(value.text) ?? stringFrom(value.content),
    metadata,
  });
}

export function extractSourcesFromUnknown(value: unknown): MessageSource[] {
  if (Array.isArray(value)) return value.flatMap(extractSourcesFromUnknown);
  if (!isRecord(value)) return [];

  const nested = [value.sources, value.citations, value.annotations]
    .flatMap(extractSourcesFromUnknown);

  const direct = sourceFromAiSdkDataStream(value);
  if (direct) nested.unshift(direct);
  return nested;
}

export function sourcesFromAiSdkMetadataFrame(obj: Record<string, unknown>): MessageSource[] {
  if (obj.type !== 'message-metadata') return [];
  return extractSourcesFromUnknown(obj.messageMetadata ?? obj.metadata ?? obj.data);
}
