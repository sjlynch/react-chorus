import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Markdown } from '../components/Markdown';
import { HLJS_THEME_STYLE_ID_PREFIX } from '../utils/hljs/theme';
import {
  getChorusStyleNonce,
  setChorusStyleNonce,
} from '../utils/cspNonce';
import { setChorusStyleNonce as setChorusStyleNonceFromBarrel } from '../index';

const README_PATH = resolve(__dirname, '..', '..', 'README.md');
const README = readFileSync(README_PATH, 'utf8');

function extractCspSection(): string {
  const start = README.indexOf('## Security and CSP');
  expect(start, 'README "## Security and CSP" heading not found').toBeGreaterThan(-1);
  const end = README.indexOf('\n## ', start + '## Security and CSP'.length);
  return end === -1 ? README.slice(start) : README.slice(start, end);
}

beforeEach(() => {
  setChorusStyleNonce(null);
  delete (globalThis as { __chorusStyleNonce?: unknown }).__chorusStyleNonce;
  document.getElementById('chorus-md-styles')?.remove();
});

afterEach(() => {
  cleanup();
  setChorusStyleNonce(null);
  delete (globalThis as { __chorusStyleNonce?: unknown }).__chorusStyleNonce;
  document.getElementById('chorus-md-styles')?.remove();
});

describe('CSP nonce support', () => {
  it('re-exports setChorusStyleNonce from the root barrel', () => {
    expect(setChorusStyleNonceFromBarrel).toBe(setChorusStyleNonce);
  });

  it('applies the configured nonce to the chorus-md-styles <style> tag', () => {
    setChorusStyleNonce('test-nonce-abc');
    render(<Markdown text="Hello" />);
    const styleEl = document.getElementById('chorus-md-styles') as HTMLStyleElement | null;
    expect(styleEl).not.toBeNull();
    expect(styleEl?.getAttribute('nonce')).toBe('test-nonce-abc');
  });

  it('omits the nonce attribute when none is configured', () => {
    render(<Markdown text="Hello" />);
    const styleEl = document.getElementById('chorus-md-styles') as HTMLStyleElement | null;
    expect(styleEl).not.toBeNull();
    expect(styleEl?.hasAttribute('nonce')).toBe(false);
  });

  it('reads the nonce from a global __chorusStyleNonce fallback', () => {
    (globalThis as { __chorusStyleNonce?: string }).__chorusStyleNonce = 'from-global';
    expect(getChorusStyleNonce()).toBe('from-global');
    render(<Markdown text="Hello" />);
    const styleEl = document.getElementById('chorus-md-styles') as HTMLStyleElement | null;
    expect(styleEl?.getAttribute('nonce')).toBe('from-global');
  });

  it('ignores empty-string nonces', () => {
    setChorusStyleNonce('');
    expect(getChorusStyleNonce()).toBeNull();
  });
});

describe('README CSP guidance matches runtime behavior', () => {
  it('names every runtime-injected <style> id so doc/runtime cannot silently drift', () => {
    const cspSection = extractCspSection();
    expect(cspSection).toContain('#chorus-md-styles');
    expect(cspSection.includes('#chorus-hljs-theme-') || cspSection.includes('chorus-hljs-theme-')).toBe(true);
    expect(HLJS_THEME_STYLE_ID_PREFIX).toBe('chorus-hljs-theme-');
  });

  it('documents nonce + headless as the strict-CSP escape hatches', () => {
    const cspSection = extractCspSection();
    expect(cspSection).toMatch(/setChorusStyleNonce/);
    expect(cspSection).toMatch(/react-chorus\/headless/);
    expect(cspSection.toLowerCase()).toContain('strict csp');
  });

  it('keeps the documented default CSP snippet honest about needing inline styles', () => {
    const cspSection = extractCspSection();
    const fenceRegex = /```[\s\S]*?```/g;
    const fences = cspSection.match(fenceRegex) ?? [];
    expect(fences.length, 'expected at least one fenced CSP example under Security and CSP').toBeGreaterThan(0);
    const defaultCsp = fences[0];
    const styleSrcLine = defaultCsp.split('\n').find((line) => line.trim().startsWith('style-src '));
    expect(styleSrcLine, 'default CSP example must declare a style-src directive').toBeTruthy();
    expect(
      styleSrcLine!.includes("'unsafe-inline'") || styleSrcLine!.includes("'nonce-"),
      `default style-src must allow runtime <style> injection: saw "${styleSrcLine}"`,
    ).toBe(true);
  });
});
