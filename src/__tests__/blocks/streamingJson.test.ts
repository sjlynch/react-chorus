import { describe, it, expect } from 'vitest';
import { parseStreamingJson } from '../../blocks/streamingJson';

describe('parseStreamingJson', () => {
  it('returns undefined for empty input', () => {
    expect(parseStreamingJson('').value).toBeUndefined();
  });

  it('parses already-complete JSON', () => {
    expect(parseStreamingJson('{"a":1,"b":"x"}').value).toEqual({ a: 1, b: 'x' });
    expect(parseStreamingJson('[1,2,3]').value).toEqual([1, 2, 3]);
  });

  it('closes an unterminated open brace', () => {
    expect(parseStreamingJson('{"a":1').value).toEqual({ a: 1 });
  });

  it('closes an unterminated open bracket', () => {
    expect(parseStreamingJson('[1,2').value).toEqual([1, 2]);
  });

  it('drops an unterminated trailing string and the colon/key', () => {
    expect(parseStreamingJson('{"a":1,"b":"par').value).toEqual({ a: 1 });
  });

  it('drops a trailing comma', () => {
    expect(parseStreamingJson('{"a":1,').value).toEqual({ a: 1 });
  });

  it('drops a trailing colon and its preceding key', () => {
    expect(parseStreamingJson('{"a":1,"b":').value).toEqual({ a: 1 });
  });

  it('keeps a complete tail number', () => {
    expect(parseStreamingJson('{"a":1,"b":2').value).toEqual({ a: 1, b: 2 });
  });

  it('handles nested partial structures', () => {
    expect(parseStreamingJson('{"city":"SF","temp":{"high":70').value).toEqual({ city: 'SF', temp: { high: 70 } });
  });

  it('produces partial values across a stream of growing prefixes', () => {
    const final = '{"name":"WeatherCard","props":{"city":"San Francisco","temp":68}}';
    const seen: unknown[] = [];
    for (let i = 1; i <= final.length; i++) {
      const r = parseStreamingJson(final.slice(0, i));
      if (r.ok) seen.push(r.value);
    }
    // Last value matches the fully parsed object.
    expect(seen[seen.length - 1]).toEqual(JSON.parse(final));
    // We saw multiple distinct intermediate values during streaming.
    expect(seen.length).toBeGreaterThan(2);
  });
});
