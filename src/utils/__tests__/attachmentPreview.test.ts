import { describe, it, expect } from 'vitest';
import type { Attachment } from '../../types';
import { isRenderableAttachmentSource, getAttachmentPreviewSource } from '../attachmentPreview';

function makeAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return { name: 'file.png', type: 'image/png', data: '', size: 1, ...overrides };
}

describe('isRenderableAttachmentSource', () => {
  it('rejects missing/empty sources', () => {
    expect(isRenderableAttachmentSource(undefined)).toBe(false);
    expect(isRenderableAttachmentSource('')).toBe(false);
  });

  it('allows blob: and http(s): sources without inline MIME info', () => {
    expect(isRenderableAttachmentSource('blob:https://example.com/abc-123')).toBe(true);
    expect(isRenderableAttachmentSource('https://example.com/img.png')).toBe(true);
    expect(isRenderableAttachmentSource('http://example.com/img.png')).toBe(true);
  });

  it('rejects non-renderable schemes (file ids, gs:// URIs)', () => {
    expect(isRenderableAttachmentSource('gs://bucket/object')).toBe(false);
    expect(isRenderableAttachmentSource('file-abc-123')).toBe(false);
    expect(isRenderableAttachmentSource('ftp://example.com/img.png')).toBe(false);
  });

  it('allows curated safe data: image MIME types', () => {
    for (const mime of ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/avif']) {
      expect(isRenderableAttachmentSource(`data:${mime};base64,AAAA`)).toBe(true);
    }
  });

  it('allows data: PDF, audio/* and video/* previews', () => {
    expect(isRenderableAttachmentSource('data:application/pdf;base64,AAAA')).toBe(true);
    expect(isRenderableAttachmentSource('data:audio/mpeg;base64,AAAA')).toBe(true);
    expect(isRenderableAttachmentSource('data:video/mp4;base64,AAAA')).toBe(true);
  });

  it('matches the data: MIME type case-insensitively', () => {
    expect(isRenderableAttachmentSource('DATA:IMAGE/PNG;base64,AAAA')).toBe(true);
  });

  it('rejects script-capable data: URLs (XSS)', () => {
    expect(isRenderableAttachmentSource('data:image/svg+xml,<svg onload=alert(1)>')).toBe(false);
    expect(isRenderableAttachmentSource('data:image/svg+xml;base64,AAAA')).toBe(false);
    expect(isRenderableAttachmentSource('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isRenderableAttachmentSource('data:application/xhtml+xml,<html/>')).toBe(false);
  });

  it('rejects malformed data: URLs', () => {
    expect(isRenderableAttachmentSource('data:')).toBe(false);
    expect(isRenderableAttachmentSource('data:image/png')).toBe(false);
    expect(isRenderableAttachmentSource('data:,plain')).toBe(false);
  });
});

describe('getAttachmentPreviewSource', () => {
  it('prefers a renderable url over data', () => {
    const att = makeAttachment({ url: 'https://example.com/img.png', data: 'data:image/png;base64,AAAA' });
    expect(getAttachmentPreviewSource(att)).toBe('https://example.com/img.png');
  });

  it('falls back to a valid data: URL when url is a non-renderable file id', () => {
    const att = makeAttachment({ url: 'provider-file-abc123', data: 'data:image/png;base64,AAAA' });
    expect(getAttachmentPreviewSource(att)).toBe('data:image/png;base64,AAAA');
  });

  it('falls back to data when url is an empty string', () => {
    const att = makeAttachment({ url: '', data: 'data:image/png;base64,AAAA' });
    expect(getAttachmentPreviewSource(att)).toBe('data:image/png;base64,AAAA');
  });

  it('falls back to data when url is a gs:// URI', () => {
    const att = makeAttachment({ url: 'gs://bucket/object', data: 'data:image/jpeg;base64,AAAA' });
    expect(getAttachmentPreviewSource(att)).toBe('data:image/jpeg;base64,AAAA');
  });

  it('returns undefined when neither candidate is renderable', () => {
    const att = makeAttachment({ url: 'gs://bucket/object', data: 'provider-file-id' });
    expect(getAttachmentPreviewSource(att)).toBeUndefined();
  });

  it('returns undefined for an svg data URL even when declared as an image (XSS)', () => {
    const att = makeAttachment({ type: 'image/svg+xml', data: 'data:image/svg+xml,<svg onload=alert(1)>' });
    expect(getAttachmentPreviewSource(att)).toBeUndefined();
  });

  it('returns undefined for a text/html data URL', () => {
    const att = makeAttachment({ type: 'text/html', data: 'data:text/html,<script>alert(1)</script>' });
    expect(getAttachmentPreviewSource(att)).toBeUndefined();
  });
});
