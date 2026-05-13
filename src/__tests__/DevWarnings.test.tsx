import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ChatWindow } from '../components/ChatWindow';
import type { Message } from '../types';

const USER_MSG: Message = { id: 'u1', role: 'user', text: 'Hello' };
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_PROCESS = globalThis.process;

afterEach(() => {
  Object.defineProperty(globalThis, 'process', { value: ORIGINAL_PROCESS, configurable: true, writable: true });
  ORIGINAL_PROCESS.env.NODE_ENV = ORIGINAL_NODE_ENV;
  vi.restoreAllMocks();
  cleanup();
});

describe('development warnings', () => {
  it('does not warn about showSystemMessages in production', () => {
    process.env.NODE_ENV = 'production';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    render(<ChatWindow messages={[USER_MSG]} showSystemMessages headless />);

    expect(warn).not.toHaveBeenCalled();
  });

  it('does not throw when process is unavailable in the browser runtime', () => {
    let thrown: unknown;
    Object.defineProperty(globalThis, 'process', { value: undefined, configurable: true, writable: true });

    try {
      render(<ChatWindow messages={[USER_MSG]} showSystemMessages headless />);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeUndefined();
  });

  it('warns about showSystemMessages once in development', () => {
    process.env.NODE_ENV = 'development';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { rerender } = render(<ChatWindow messages={[USER_MSG]} showSystemMessages headless />);

    rerender(<ChatWindow messages={[USER_MSG]} showSystemMessages headless />);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('showSystemMessages'));
  });
});
