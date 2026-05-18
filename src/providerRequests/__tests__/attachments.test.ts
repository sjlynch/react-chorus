import { describe, expect, it } from 'vitest';
import { dataUrlFromAttachment } from '../attachments';

describe('dataUrlFromAttachment / parseDataUrl', () => {
  it('returns null for a base64 data URL with an empty payload', () => {
    expect(dataUrlFromAttachment({ name: 'stub.png', type: 'image/png', data: 'data:image/png;base64,', size: 0 })).toBeNull();
  });

  it('parses a base64 data URL with a non-empty payload', () => {
    expect(dataUrlFromAttachment({ name: 'photo.png', type: 'image/png', data: 'data:image/png;base64,aGVsbG8=', size: 5 })).toEqual({
      mimeType: 'image/png',
      base64: 'aGVsbG8=',
    });
  });

  it('defaults mimeType to application/octet-stream when missing', () => {
    expect(dataUrlFromAttachment({ name: 'blob', type: '', data: 'data:;base64,Zm9v', size: 3 })).toEqual({
      mimeType: 'application/octet-stream',
      base64: 'Zm9v',
    });
  });

  it('returns null when the attachment has no data string', () => {
    expect(dataUrlFromAttachment({ name: 'x', type: 'image/png', data: '', size: 0 })).toBeNull();
  });
});
