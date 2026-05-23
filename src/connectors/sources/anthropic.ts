import type { MessageSource } from '../../types';
import { buildSource, isRecord, numberFrom, stringFrom, withDefinedMetadata } from './shared';

/**
 * Anthropic Messages API citations attached to text content blocks. Each
 * citation can be a `char_location` / `page_location` / `content_block_location`
 * pointing at a tool-supplied document, or a `web_search_result_location`
 * pointing at a web search hit. We map all of them to `MessageSource` so the
 * default renderer shows them consistently with other providers; the original
 * location offsets and document index are preserved on `metadata` so callers
 * can re-anchor citations to source text if needed.
 */
export function sourceFromAnthropicCitation(citation: unknown): MessageSource | null {
  if (!isRecord(citation)) return null;
  const rawType = stringFrom(citation.type);
  const url = stringFrom(citation.url);
  const isWeb = rawType === 'web_search_result_location' || Boolean(url);
  const documentIndex = numberFrom(citation.document_index);
  const documentTitle = stringFrom(citation.document_title);
  const citedText = stringFrom(citation.cited_text);
  const metadata = withDefinedMetadata({
    provider: 'anthropic',
    citationType: rawType,
    documentIndex,
    documentTitle,
    startCharIndex: numberFrom(citation.start_char_index),
    endCharIndex: numberFrom(citation.end_char_index),
    startPageNumber: numberFrom(citation.start_page_number),
    endPageNumber: numberFrom(citation.end_page_number),
    startBlockIndex: numberFrom(citation.start_block_index),
    endBlockIndex: numberFrom(citation.end_block_index),
    encryptedIndex: stringFrom(citation.encrypted_index),
  });
  // Citations have no provider-issued id, so derive a stable one from the
  // location so repeated streamed citations dedup through appendMessageSource.
  const id = url
    ?? (documentIndex !== undefined && documentTitle ? `${documentTitle}#${documentIndex}` : undefined)
    ?? (documentIndex !== undefined ? `anthropic-document-${documentIndex}` : undefined);
  return buildSource({
    id,
    type: isWeb ? 'url' : 'document',
    title: stringFrom(citation.title) ?? documentTitle,
    url,
    snippet: citedText,
    metadata,
  });
}

/**
 * Anthropic `web_search_tool_result` content blocks carry a `content` array of
 * `web_search_result` entries (`{ url, title, encrypted_content, page_age }`).
 * Surface each as a `MessageSource` so a web-search tool turn shows its hits
 * in the same Sources footer as inline citations, without leaking the raw
 * encrypted content into the assistant text.
 */
export function sourcesFromAnthropicWebSearchToolResult(block: unknown): MessageSource[] {
  if (!isRecord(block)) return [];
  const content = block.content;
  if (!Array.isArray(content)) return [];
  const toolUseId = stringFrom(block.tool_use_id);
  const sources: MessageSource[] = [];
  for (const entry of content) {
    if (!isRecord(entry) || entry.type !== 'web_search_result') continue;
    const url = stringFrom(entry.url);
    const metadata = withDefinedMetadata({
      provider: 'anthropic',
      resultType: 'web_search_result',
      toolUseId,
      pageAge: stringFrom(entry.page_age),
      encryptedContent: stringFrom(entry.encrypted_content),
    });
    const source = buildSource({
      id: url,
      type: 'url',
      title: stringFrom(entry.title),
      url,
      metadata,
    });
    if (source) sources.push(source);
  }
  return sources;
}
