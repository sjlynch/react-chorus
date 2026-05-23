import { sourceFromAnthropicCitation } from '../sourceMapping';
import type { ConnectorResult } from '../types';
import type { MessageSource } from '../../types';

export function collectAnthropicCitations(list: unknown[] | undefined): MessageSource[] {
  if (!list) return [];
  const sources: MessageSource[] = [];
  for (const entry of list) {
    const source = sourceFromAnthropicCitation(entry);
    if (source) sources.push(source);
  }
  return sources;
}

// `source`/`sources` are mutually exclusive in ConnectorResult: a single
// source goes on `source`, multiple on `sources`. Pick the right slot so
// useChorusStream's source pipeline appends every entry through
// `appendMessageSource` instead of dropping array elements.
export function sourcesResult(sources: MessageSource[]): ConnectorResult {
  return sources.length === 1
    ? { source: sources[0] as MessageSource }
    : { sources };
}
