import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { ChatWindow } from '../components/ChatWindow';
import { Chorus } from '../Chorus';
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

  it('warns when both messages and initialMessages are provided', async () => {
    process.env.NODE_ENV = 'development';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    render(<Chorus messages={[]} initialMessages={[]} />);

    await waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('Both `messages` and `initialMessages`')));
  });

  it('warns when connector is provided for an onSend-only flow', async () => {
    process.env.NODE_ENV = 'development';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    render(<Chorus connector="anthropic" onSend={vi.fn()} />);

    await waitFor(() => expect(warn).toHaveBeenCalledWith('[Chorus] `connector` only applies to the `transport` send path. With `onSend` you parse the response yourself — pass `connector` into the `useChorusStream` call inside your `onSend` if you need it.'));
  });

  it('warns when connectorOptions is provided for an onSend-only flow', async () => {
    process.env.NODE_ENV = 'development';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    render(<Chorus connectorOptions={{ thinkTag: { start: '<r>', end: '</r>' } }} onSend={vi.fn()} />);

    await waitFor(() => expect(warn).toHaveBeenCalledWith('[Chorus] `connectorOptions` only applies to the `transport` send path. With `onSend` you parse the response yourself — pass `connectorOptions` into the `useChorusStream` call inside your `onSend` if you need it.'));
  });

  it('warns that connectorOptions are ignored when connector is not "openai"', async () => {
    process.env.NODE_ENV = 'development';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    render(
      <Chorus
        transport={async () => new Response(null, { status: 200 })}
        connector="anthropic"
        connectorOptions={{ thinkTag: { start: '<r>', end: '</r>' } }}
      />,
    );

    await waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('the `anthropic` connector does not accept them')));
  });

  it('warns when value is provided without onChange', async () => {
    process.env.NODE_ENV = 'development';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    render(<Chorus value={[]} />);

    await waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('`value` makes Chorus controlled')));
  });

  it('warns when shouldContinueToolLoop is provided without autoContinueTools', async () => {
    process.env.NODE_ENV = 'development';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    render(
      <Chorus
        transport={async () => new Response(null, { status: 200 })}
        shouldContinueToolLoop={() => true}
      />,
    );

    await waitFor(() => expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/`shouldContinueToolLoop` is ignored unless `autoContinueTools` is enabled/),
    ));
  });

  it('warns when maxToolIterations is provided without autoContinueTools', async () => {
    process.env.NODE_ENV = 'development';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    render(
      <Chorus
        transport={async () => new Response(null, { status: 200 })}
        maxToolIterations={8}
      />,
    );

    await waitFor(() => expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/`maxToolIterations` is ignored unless `autoContinueTools` is enabled/),
    ));
  });

  it('warns when tool-loop props require transport on the onSend path', async () => {
    process.env.NODE_ENV = 'development';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    render(
      <Chorus
        onSend={vi.fn()}
        autoContinueTools
        shouldContinueToolLoop={() => true}
        maxToolIterations={8}
      />,
    );

    await waitFor(() => expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/`shouldContinueToolLoop` and `maxToolIterations` are ignored without `transport`/),
    ));
  });

  it('does not warn about tool-loop props when autoContinueTools and transport are both set', async () => {
    process.env.NODE_ENV = 'development';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    render(
      <Chorus
        transport={async () => new Response(null, { status: 200 })}
        autoContinueTools
        shouldContinueToolLoop={() => true}
        maxToolIterations={8}
      />,
    );

    await waitFor(() => expect(warn).not.toHaveBeenCalledWith(
      expect.stringMatching(/`shouldContinueToolLoop`|`maxToolIterations`/),
    ));
  });

  it('warns when an unknown connector string falls back to auto', async () => {
    process.env.NODE_ENV = 'development';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    render(
      <Chorus
        transport={async () => new Response(null, { status: 200 })}
        // @ts-expect-error exercising JavaScript callers with a misspelled string
        connector="openia"
      />,
    );

    await waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('Unknown connector `openia`')));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('auto, openai, anthropic, gemini'));
  });
});
