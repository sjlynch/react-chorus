import type { MessageSource } from '../../types';
import { buildSource, isRecord, normalizeSourceType, numberFrom, recordFrom, stringFrom, withDefinedMetadata } from './shared';

export function sourceFromOpenAIResponseAnnotation(annotation: unknown): MessageSource | null {
  if (!isRecord(annotation)) return null;
  const rawType = stringFrom(annotation.type ?? annotation.sourceType);
  const type = normalizeSourceType(rawType, stringFrom(annotation.url) ? 'url' : 'unknown');
  const metadata = withDefinedMetadata({
    provider: 'openai',
    annotationType: rawType,
    startIndex: numberFrom(annotation.start_index),
    endIndex: numberFrom(annotation.end_index),
    index: numberFrom(annotation.index),
    fileId: annotation.file_id,
    containerId: annotation.container_id,
  });
  return buildSource({
    id: stringFrom(annotation.id) ?? stringFrom(annotation.file_id) ?? stringFrom(annotation.url),
    type,
    title: stringFrom(annotation.title) ?? stringFrom(annotation.filename) ?? stringFrom(annotation.file_name) ?? stringFrom(annotation.name),
    url: stringFrom(annotation.url),
    snippet: stringFrom(annotation.quote) ?? stringFrom(annotation.snippet) ?? stringFrom(annotation.text),
    metadata,
  });
}

function sourcesFromOpenAIUnknown(value: unknown): MessageSource[] {
  if (Array.isArray(value)) return value.flatMap(sourcesFromOpenAIUnknown);
  if (!isRecord(value)) return [];

  const nested = [value.sources, value.citations, value.annotations]
    .flatMap(sourcesFromOpenAIUnknown);
  const direct = sourceFromOpenAIResponseAnnotation(value);
  if (direct) nested.unshift(direct);
  return nested;
}

export function sourcesFromOpenAIResponseEvent(obj: Record<string, unknown>): MessageSource[] {
  return [obj.annotation, obj.annotations, recordFrom(obj.output_text)?.annotations]
    .flatMap(sourcesFromOpenAIUnknown);
}
