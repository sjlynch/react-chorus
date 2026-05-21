import { describe, it, expect } from 'vitest';
import { geminiConnector } from '../../connectors/gemini';

describe('geminiConnector', () => {
  it('extracts text from candidates content parts', () => {
    const data = JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'Hello' }] } }],
    });
    expect(geminiConnector.extract(data)).toEqual({ text: 'Hello' });
  });

  it('concatenates text across multiple parts', () => {
    const data = JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'foo' }, { text: 'bar' }] } }],
    });
    expect(geminiConnector.extract(data)).toEqual({ text: 'foobar' });
  });

  it('selects candidate index 0 instead of concatenating alternatives', () => {
    const data = JSON.stringify({
      candidates: [
        { index: 1, content: { parts: [{ text: 'alternative' }] } },
        { index: 0, content: { parts: [{ text: 'selected' }] } },
      ],
    });
    expect(geminiConnector.extract(data)).toEqual({ text: 'selected' });
  });

  it('extracts thought parts as reasoning', () => {
    const data = JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'hidden chain', thought: true }] } }],
    });
    expect(geminiConnector.extract(data)).toEqual({ reasoning: 'hidden chain' });
  });

  it('extracts functionCall parts as tool deltas', () => {
    const data = JSON.stringify({
      candidates: [{ index: 0, content: { parts: [{ functionCall: { name: 'lookup', args: { q: 'test' } } }] } }],
    });
    expect(geminiConnector.extract(data)).toEqual({
      toolDelta: { id: 'gemini-0-function-0-lookup', name: 'lookup', input: { q: 'test' }, provider: 'gemini', generated: true },
    });
  });

  it('ignores stray response property on functionCall parts (off-spec for Gemini wire format)', () => {
    const data = JSON.stringify({
      candidates: [{ index: 0, content: { parts: [{
        functionCall: { name: 'lookup', args: { q: 'test' }, response: { ignored: true } },
      }] } }],
    });
    expect(geminiConnector.extract(data)).toEqual({
      toolDelta: { id: 'gemini-0-function-0-lookup', name: 'lookup', input: { q: 'test' }, provider: 'gemini', generated: true },
    });
  });

  it('extracts multiple functionCall parts as tool deltas', () => {
    const data = JSON.stringify({
      candidates: [{ index: 0, content: { parts: [
        { text: 'using tools' },
        { functionCall: { name: 'lookup', args: { q: 'test' } } },
        { functionCall: { id: 'gemini-call-2', name: 'weather', args: { city: 'Paris' } } },
      ] } }],
    });

    expect(geminiConnector.extract(data)).toEqual({
      text: 'using tools',
      toolDelta: { id: 'gemini-0-function-1-lookup', name: 'lookup', input: { q: 'test' }, provider: 'gemini', generated: true },
      toolDeltas: [
        { id: 'gemini-0-function-1-lookup', name: 'lookup', input: { q: 'test' }, provider: 'gemini', generated: true },
        { id: 'gemini-call-2', name: 'weather', input: { city: 'Paris' }, provider: 'gemini', providerId: 'gemini-call-2' },
      ],
    });
  });

  it('returns done for normal STOP with no text', () => {
    const data = JSON.stringify({
      candidates: [{ finishReason: 'STOP', content: { parts: [] } }],
    });
    expect(geminiConnector.extract(data)).toEqual({ done: true });
  });

  it('returns text and done for normal STOP alongside text', () => {
    const data = JSON.stringify({
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'end' }] } }],
    });
    expect(geminiConnector.extract(data)).toEqual({ text: 'end', done: true });
  });

  it('returns done for MAX_TOKENS with a truncated warning and finishReason metadata', () => {
    const payload = {
      candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'truncated' }] } }],
    };
    const data = JSON.stringify(payload);
    const result = geminiConnector.extract(data);
    expect(result).toEqual({
      text: 'truncated',
      done: true,
      metadata: { finishReason: 'MAX_TOKENS' },
      warning: {
        code: 'truncated',
        message: 'Gemini response truncated by maxOutputTokens',
        payload,
      },
    });
    expect(result?.warning?.code).toBe('truncated');
  });

  it.each(['FINISH_REASON_UNSPECIFIED', 'UNSPECIFIED'])('returns an error for Gemini %s finish reason', finishReason => {
    const payload = {
      candidates: [{ finishReason, content: { parts: [{ text: 'Hello' }] } }],
    };
    expect(geminiConnector.extract(JSON.stringify(payload))).toEqual({
      text: 'Hello',
      error: 'Gemini response ended with an unspecified finish reason',
      errorPayload: payload,
    });
  });

  it('returns an error for blocked SAFETY with no text', () => {
    const safetyRatings = [{ category: 'HARM_CATEGORY_DANGEROUS_CONTENT' }];
    const payload = {
      candidates: [{ finishReason: 'SAFETY', content: { parts: [] }, safetyRatings }],
    };
    expect(geminiConnector.extract(JSON.stringify(payload))).toEqual({
      error: 'Gemini response was blocked and returned no text (finishReason: SAFETY)',
      errorPayload: payload,
      metadata: { safetyRatings },
    });
  });

  it('folds the worst safetyRatings category into the blocked-finish-reason error message', () => {
    const safetyRatings = [
      { category: 'HARM_CATEGORY_HARASSMENT', probability: 'LOW' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', probability: 'HIGH' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', probability: 'NEGLIGIBLE' },
    ];
    const payload = {
      candidates: [{ finishReason: 'SAFETY', content: { parts: [] }, safetyRatings }],
    };
    expect(geminiConnector.extract(JSON.stringify(payload))).toEqual({
      error: 'Gemini response was blocked and returned no text (finishReason: SAFETY) (worst category: HARM_CATEGORY_HATE_SPEECH)',
      errorPayload: payload,
      metadata: { safetyRatings },
    });
  });

  it('treats a rating with blocked: true as the worst category regardless of probability', () => {
    const safetyRatings = [
      { category: 'HARM_CATEGORY_HARASSMENT', probability: 'HIGH' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', probability: 'LOW', blocked: true },
    ];
    const payload = {
      candidates: [{ finishReason: 'SAFETY', content: { parts: [] }, safetyRatings }],
    };
    expect(geminiConnector.extract(JSON.stringify(payload))).toEqual({
      error: 'Gemini response was blocked and returned no text (finishReason: SAFETY) (worst category: HARM_CATEGORY_SEXUALLY_EXPLICIT)',
      errorPayload: payload,
      metadata: { safetyRatings },
    });
  });

  it('attaches safetyRatings as metadata on an unblocked candidate so diagnostics survive', () => {
    const safetyRatings = [{ category: 'HARM_CATEGORY_HATE_SPEECH', probability: 'NEGLIGIBLE' }];
    const data = JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'hi' }] }, safetyRatings }],
    });
    expect(geminiConnector.extract(data)).toEqual({
      text: 'hi',
      metadata: { safetyRatings },
    });
  });

  it('surfaces promptFeedback.blockReason as an error even when candidates is empty', () => {
    const payload = {
      candidates: [],
      promptFeedback: {
        blockReason: 'SAFETY',
        safetyRatings: [{ category: 'HARM_CATEGORY_HATE_SPEECH', probability: 'HIGH' }],
      },
    };
    expect(geminiConnector.extract(JSON.stringify(payload))).toEqual({
      error: 'Gemini blocked the prompt (blockReason: SAFETY, worst category: HARM_CATEGORY_HATE_SPEECH)',
      errorPayload: payload,
    });
  });

  it('surfaces promptFeedback.blockReason as an error when candidates is missing entirely', () => {
    const payload = { promptFeedback: { blockReason: 'OTHER' } };
    expect(geminiConnector.extract(JSON.stringify(payload))).toEqual({
      error: 'Gemini blocked the prompt (blockReason: OTHER)',
      errorPayload: payload,
    });
  });

  it('returns partial text and an error for blocked SAFETY with text', () => {
    const payload = {
      candidates: [{ finishReason: 'SAFETY', content: { parts: [{ text: 'partial' }] } }],
    };
    expect(geminiConnector.extract(JSON.stringify(payload))).toEqual({
      text: 'partial',
      error: 'Gemini response ended with blocked finishReason: SAFETY',
      errorPayload: payload,
    });
  });

  it('returns null when candidates array is empty', () => {
    const data = JSON.stringify({ candidates: [] });
    expect(geminiConnector.extract(data)).toBeNull();
  });

  it('returns null for JSON without candidates', () => {
    const data = JSON.stringify({ choices: [{ delta: { content: 'hi' } }] });
    expect(geminiConnector.extract(data)).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(geminiConnector.extract('not json')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(geminiConnector.extract('')).toBeNull();
  });

  it('returns null for candidate with empty parts text', () => {
    const data = JSON.stringify({
      candidates: [{ content: { parts: [{ text: '' }] } }],
    });
    expect(geminiConnector.extract(data)).toBeNull();
  });

  it('returns an in-band error payload', () => {
    const payload = { error: { message: 'gemini failed' } };
    expect(geminiConnector.extract(JSON.stringify(payload))).toEqual({ error: 'gemini failed', errorPayload: payload });
  });

  describe('createState — stable fallback function-call ids', () => {
    it('exposes createState', () => {
      expect(typeof geminiConnector.createState).toBe('function');
      expect(geminiConnector.createState?.()).toBeTruthy();
    });

    it('keeps one fallback id when a function call streams name then args-only across frames', () => {
      const state = geminiConnector.createState!();
      // Frame 1: name + partial args, no provider id.
      const frame1 = JSON.stringify({
        candidates: [{ index: 0, content: { parts: [{ functionCall: { name: 'get_weather', args: { city: 'SF' } } }] } }],
      });
      // Frame 2: same candidate/part, arguments continue, provider omits `name`.
      const frame2 = JSON.stringify({
        candidates: [{ index: 0, content: { parts: [{ functionCall: { args: { unit: 'celsius' } } }] } }],
      });

      const r1 = geminiConnector.extract(frame1, state);
      const r2 = geminiConnector.extract(frame2, state);

      expect(r1?.toolDelta).toEqual({
        id: 'gemini-0-function-0-get_weather',
        name: 'get_weather',
        input: { city: 'SF' },
        provider: 'gemini',
        generated: true,
      });
      // Without remembered state, frame 2 (no `name`) would compute
      // `gemini-0-function-0-call` and render a duplicate placeholder block.
      expect(r2?.toolDelta).toEqual({
        id: 'gemini-0-function-0-get_weather',
        input: { unit: 'celsius' },
        provider: 'gemini',
        generated: true,
      });
      expect(r1?.toolDelta?.id).toBe(r2?.toolDelta?.id);
    });

    it('recomputes a fresh id per frame when no shared state is passed (the pre-fix behaviour)', () => {
      const frame1 = JSON.stringify({
        candidates: [{ index: 0, content: { parts: [{ functionCall: { name: 'get_weather', args: { city: 'SF' } } }] } }],
      });
      const frame2 = JSON.stringify({
        candidates: [{ index: 0, content: { parts: [{ functionCall: { args: { unit: 'celsius' } } }] } }],
      });
      expect(geminiConnector.extract(frame1)?.toolDelta?.id).toBe('gemini-0-function-0-get_weather');
      expect(geminiConnector.extract(frame2)?.toolDelta?.id).toBe('gemini-0-function-0-call');
    });

    it('reuses a provider id across frames when later frames omit it', () => {
      const state = geminiConnector.createState!();
      const frame1 = JSON.stringify({
        candidates: [{ index: 0, content: { parts: [{ functionCall: { id: 'fc_abc', name: 'lookup', args: { q: 'a' } } }] } }],
      });
      const frame2 = JSON.stringify({
        candidates: [{ index: 0, content: { parts: [{ functionCall: { args: { q: 'b' } } }] } }],
      });

      expect(geminiConnector.extract(frame1, state)?.toolDelta).toEqual({
        id: 'fc_abc',
        name: 'lookup',
        input: { q: 'a' },
        provider: 'gemini',
        providerId: 'fc_abc',
      });
      expect(geminiConnector.extract(frame2, state)?.toolDelta).toEqual({
        id: 'fc_abc',
        input: { q: 'b' },
        provider: 'gemini',
        providerId: 'fc_abc',
      });
    });
  });

  describe('inlineData / fileData parts', () => {
    it('emits an unsupported-part warning instead of dropping a pure-inlineData chunk', () => {
      const payload = {
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgo=' } }] } }],
      };
      const result = geminiConnector.extract(JSON.stringify(payload));
      expect(result).not.toBeNull();
      expect(result?.warning?.code).toBe('unsupported-part');
      expect(result?.warning?.message).toContain('inlineData (image/png)');
      expect(result?.warning?.payload).toEqual(payload);
    });

    it('emits an unsupported-part warning for fileData parts', () => {
      const payload = {
        candidates: [{ content: { parts: [{ fileData: { mimeType: 'image/jpeg', fileUri: 'gs://bucket/img.jpg' } }] } }],
      };
      const result = geminiConnector.extract(JSON.stringify(payload));
      expect(result?.warning?.code).toBe('unsupported-part');
      expect(result?.warning?.message).toContain('fileData (image/jpeg)');
    });

    it('keeps text alongside an unsupported inlineData part in the same candidate', () => {
      const data = JSON.stringify({
        candidates: [{ content: { parts: [
          { text: 'Here is an image:' },
          { inlineData: { mimeType: 'image/png', data: 'AAAA' } },
        ] } }],
      });
      const result = geminiConnector.extract(data);
      expect(result?.text).toBe('Here is an image:');
      expect(result?.warning?.code).toBe('unsupported-part');
    });

    it('accepts snake_case inline_data spelling from proxies', () => {
      const data = JSON.stringify({
        candidates: [{ content: { parts: [{ inline_data: { mime_type: 'image/webp', data: 'AAAA' } }] } }],
      });
      const result = geminiConnector.extract(data);
      expect(result?.warning?.code).toBe('unsupported-part');
      expect(result?.warning?.message).toContain('inlineData (image/webp)');
    });

    it('keeps the unsupported-part warning when the same chunk also hits MAX_TOKENS', () => {
      // A multimodal model can emit an inlineData part *and* finishReason
      // MAX_TOKENS in one chunk; the truncation warning must not clobber the
      // unsupported-part warning, the only signal that content was dropped.
      const data = JSON.stringify({
        candidates: [{
          finishReason: 'MAX_TOKENS',
          content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }] },
        }],
      });
      const result = geminiConnector.extract(data);
      expect(result?.done).toBe(true);
      expect(result?.metadata).toEqual({ finishReason: 'MAX_TOKENS' });
      expect(result?.warning?.code).toBe('unsupported-part');
    });
  });
});
