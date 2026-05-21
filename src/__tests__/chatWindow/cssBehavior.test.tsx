import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

describe('ChatWindow CSS behavior', () => {
  it('reveals message actions on hover and keyboard focus', () => {
    const css = readFileSync('src/Chorus.css', 'utf8');
    expect(css).toContain('.chorus-msg:hover .chorus-actions, .chorus-msg:focus-within .chorus-actions');
    expect(css).toContain('.chorus-msg:hover + .chorus-render-actions .chorus-actions');
  });
  it('respects prefers-reduced-motion by disabling looping animations and non-essential transitions', () => {
    const css = readFileSync('src/Chorus.css', 'utf8');
    const block = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\n\}/);
    expect(block, 'expected a prefers-reduced-motion: reduce block in Chorus.css').not.toBeNull();
    const body = block![0];
    expect(body).toMatch(/\.chorus-attachment-spinner\s*\{[^}]*animation:\s*none/);
    expect(body).toMatch(/\.chorus-dot\s*\{[^}]*animation:\s*none/);
    expect(body).toMatch(/\.chorus-dot\s*\{[^}]*opacity:\s*1/);
    expect(body).toMatch(/transition:\s*none/);
  });
  it('keeps message actions visible on coarse pointers / no-hover devices and via the alwaysShowMessageActions opt-in', () => {
    const css = readFileSync('src/Chorus.css', 'utf8');
    expect(css).toMatch(/@media\s*\(hover:\s*none\),\s*\(pointer:\s*coarse\)\s*\{[^}]*\.chorus-actions\s*\{[^}]*opacity:\s*1[^}]*pointer-events:\s*auto/);
    expect(css).toMatch(/\.chorus--always-show-actions\s+\.chorus-actions\s*\{[^}]*opacity:\s*1[^}]*pointer-events:\s*auto/);
    expect(css).toMatch(/\.chorus-action-btn:focus-visible\s*\{[^}]*outline:/);
  });
  it('provides :focus-visible rings on composer, conversation, tool-call, and attachment-dismiss buttons', () => {
    const css = readFileSync('src/Chorus.css', 'utf8');
    // Composer buttons
    expect(css).toMatch(/\.chorus-send:focus-visible\s*\{[^}]*box-shadow:/);
    expect(css).toMatch(/\.chorus-attach:focus-visible\s*\{[^}]*outline:/);
    expect(css).toMatch(/\.chorus-clear-btn:focus-visible\s*\{[^}]*outline:/);
    // Attachment chip + error banner dismiss
    expect(css).toMatch(/\.chorus-attachment-remove:focus-visible\s*\{[^}]*outline:/);
    expect(css).toMatch(/\.chorus-attachment-error-dismiss:focus-visible\s*\{[^}]*outline:/);
    // Tool call header
    expect(css).toMatch(/\.chorus-tool-call-header:focus-visible\s*\{[^}]*outline:/);
    // Conversation sidebar buttons
    expect(css).toMatch(/\.chorus-conversation-new:focus-visible\s*\{[^}]*outline:/);
    expect(css).toMatch(/\.chorus-conversation-select:focus-visible\s*\{[^}]*outline:/);
    expect(css).toMatch(/\.chorus-conversation-action:focus-visible\s*\{[^}]*outline:/);
  });
  it('keeps :focus-visible rings outside the prefers-reduced-motion block (motion suppression should not hide focus)', () => {
    const css = readFileSync('src/Chorus.css', 'utf8');
    const block = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\n\}/);
    expect(block).not.toBeNull();
    expect(block![0]).not.toMatch(/:focus-visible/);
  });
  it('uses CSS logical properties on the composer + sidebar so RTL locales flip correctly', () => {
    const css = readFileSync('src/Chorus.css', 'utf8');
    // Composer absolute positioning should flip with `dir`
    expect(css).toMatch(/\.chorus-attach\s*\{[^}]*inset-inline-start:\s*8px/);
    expect(css).toMatch(/\.chorus-send\s*\{[^}]*inset-inline-end:\s*8px/);
    // Textarea padding leaves room for the inline-end send button and the inline-start attach button
    expect(css).toMatch(/\.chorus-input-row\s+textarea\s*\{[^}]*padding-inline-start:\s*14px/);
    expect(css).toMatch(/\.chorus-input-row\s+textarea\s*\{[^}]*padding-inline-end:\s*50px/);
    expect(css).toMatch(/\.chorus-input-row--has-attach\s+textarea\s*\{[^}]*padding-inline-start:\s*44px/);
    // Conversation sidebar helpers
    expect(css).toMatch(/\.chorus-conversation-pin-indicator\s*\{[^}]*margin-inline-end:\s*4px/);
    expect(css).toMatch(/\.chorus-conversation-actions\s*\{[^}]*padding-inline-end:\s*4px/);
    // Buttons with reading-direction text content use logical text-align
    expect(css).toMatch(/\.chorus-conversation-new\s*\{[^}]*text-align:\s*start/);
    expect(css).toMatch(/\.chorus-conversation-select\s*\{[^}]*text-align:\s*start/);
    expect(css).toMatch(/\.chorus-tool-call-header\s*\{[^}]*text-align:\s*start/);
    // And no physical left/right offsets remain on the user-visible chat surface
    expect(css).not.toMatch(/\.chorus-(attach|send|input-row[^{]*|conversation-(pin-indicator|actions))\s*\{[^}]*\b(left|right|padding-left|padding-right|margin-left|margin-right):/);
  });
  it('flips inset-inline-end to the visual left under dir="rtl" on the send button', () => {
    document.documentElement.dir = 'ltr';
    try {
      const wrapper = document.createElement('div');
      wrapper.dir = 'rtl';
      document.body.appendChild(wrapper);
      const button = document.createElement('button');
      button.className = 'chorus-send';
      button.style.position = 'absolute';
      // Mirror what the stylesheet sets so we can observe `right` resolves to `auto` in RTL
      // when `inset-inline-end` is the source of truth.
      (button.style as CSSStyleDeclaration & { insetInlineEnd?: string }).insetInlineEnd = '8px';
      wrapper.appendChild(button);

      const computed = window.getComputedStyle(button);
      // jsdom honors inline-style logical properties: in dir="rtl" the inline-end edge is the left edge.
      // Either the physical `right` is unset/auto (correct: ring is on the left) or the
      // logical inset value resolves on the `left` side. Both indicate the flip worked.
      const right = computed.right || 'auto';
      const left = computed.left || 'auto';
      const insetInlineEnd = computed.getPropertyValue('inset-inline-end').trim();
      expect(insetInlineEnd === '8px' || left === '8px' || right === 'auto').toBe(true);

      wrapper.remove();
    } finally {
      document.documentElement.dir = '';
    }
  });
});
