import { describe, expect, it } from 'vitest';
import DOMPurify from 'dompurify';
import { resolveSanitizer } from '../components/markdown/sanitize';

// resolveSanitizer() registers the link-hardening `afterSanitizeAttributes` hook on the
// shared DOMPurify singleton and returns its default-config sanitizer.
const defaultSanitize = resolveSanitizer();
if (!defaultSanitize) throw new Error('expected the built-in DOMPurify sanitizer to resolve under jsdom');

// DOMPurify's DEFAULT config strips `target`, so model output already cannot open a new
// browsing context (asserted last). To exercise the hardening hook we sanitize with
// `target` permitted — the same path a consumer who allows new-tab links would hit — and
// assert the globally-registered hook ran.
const keepTarget = (html: string) => DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });

function relTokens(html: string): string[] {
  const match = html.match(/rel="([^"]*)"/);
  return match ? match[1].split(/\s+/).filter(Boolean) : [];
}

describe('built-in DOMPurify link hardening (rel=noopener on new-context targets)', () => {
  it('forces rel="noopener noreferrer" on a surviving target=_blank anchor', () => {
    const out = keepTarget('<a href="https://example.com" target="_blank">x</a>');
    expect(out).toContain('target="_blank"');
    expect(relTokens(out)).toEqual(expect.arrayContaining(['noopener', 'noreferrer']));
  });

  it('preserves existing rel tokens while adding noopener/noreferrer', () => {
    const tokens = relTokens(keepTarget('<a href="https://example.com" target="_blank" rel="nofollow">x</a>'));
    expect(tokens).toContain('nofollow');
    expect(tokens).toContain('noopener');
    expect(tokens).toContain('noreferrer');
  });

  it('drops a conflicting opener token that would re-enable window.opener', () => {
    const tokens = relTokens(keepTarget('<a href="https://example.com" target="_blank" rel="opener">x</a>'));
    expect(tokens).not.toContain('opener');
    expect(tokens).toContain('noopener');
    expect(tokens).toContain('noreferrer');
  });

  it('also hardens named (non-_blank) targets that open a new browsing context', () => {
    expect(relTokens(keepTarget('<a href="https://example.com" target="popup">x</a>'))).toEqual(
      expect.arrayContaining(['noopener', 'noreferrer']),
    );
  });

  it('leaves same-context and target-less anchors untouched', () => {
    expect(keepTarget('<a href="https://example.com" target="_self">x</a>')).not.toContain('rel=');
    expect(keepTarget('<a href="https://example.com" target="_top">x</a>')).not.toContain('rel=');
    expect(keepTarget('<a href="https://example.com">x</a>')).not.toContain('rel=');
  });

  it('strips target by default, so the default sanitizer needs no rel hardening', () => {
    const out = defaultSanitize('<a href="https://example.com" target="_blank">x</a>');
    expect(out).not.toContain('target=');
    expect(out).not.toContain('rel=');
  });
});
