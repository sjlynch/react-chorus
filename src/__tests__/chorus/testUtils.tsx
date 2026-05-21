import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Chorus } from '../../Chorus';
import type { ChorusOnSend, ChorusProps, ChorusRef, ChorusSendHelpers, Transport } from '../../Chorus';
import type { Message, StorageAdapter as StorageAdapterType } from '../../types';

export type { ChorusProps, ChorusRef, Message, StorageAdapterType as StorageAdapter, Transport };
export type OnSend = ChorusOnSend;
export type OnSendHelpers = ChorusSendHelpers;
export type ChorusUser = ReturnType<typeof userEvent.setup>;

export function renderChorus<TMeta = Record<string, unknown>>(props: ChorusProps<TMeta> = {}) {
  const user = userEvent.setup();
  return {
    user,
    ...render(<Chorus<TMeta> {...props} />),
  };
}

export async function sendMessage(user: ChorusUser, text: string) {
  await user.type(screen.getByPlaceholderText('Send a message'), text);
  await user.click(screen.getByRole('button', { name: /send/i }));
}

export function sseResponse(chunks: string[], status = 200) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
      }
      controller.close();
    },
  });

  return new Response(body, { status });
}

export function erroringSSEResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  let index = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(`data: ${chunks[index]}\n\n`));
        index += 1;
        return;
      }
      controller.error(new Error('stream exploded'));
    },
  });

  return new Response(body, { status: 200 });
}

export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function makeSyncStorage(initial: Record<string, string> = {}): StorageAdapterType & { store: Record<string, string> } {
  const store = { ...initial };
  return {
    store,
    getItem: (key) => store[key] ?? null,
    setItem: (key, value) => { store[key] = value; },
  };
}
