import { useState, type ReactNode } from 'react';
import { act, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { ChatInput } from '../../components/ChatInput';
import type { ChatInputProps } from '../../components/ChatInput';

export { ChatInput } from '../../components/ChatInput';
export type { ChatInputHandle, ChatInputProps } from '../../components/ChatInput';
export type { AttachmentUploadResult } from '../../types';

export function ControlledChatInput(props: Partial<ChatInputProps>) {
  const [value, setValue] = useState(props.value ?? '');

  return (
    <ChatInput
      {...props}
      value={value}
      onChange={setValue}
      onSend={props.onSend ?? vi.fn()}
    />
  );
}

// Renders a ChatInput inside a `.chorus` widget root with a sibling transcript
// area, mirroring the real <Chorus> layout so transcript-wide drag-and-drop
// (which is wired to the surrounding surface) can be exercised.
export function ChorusSurface({ children, ...props }: Partial<ChatInputProps> & { children?: ReactNode }) {
  const [value, setValue] = useState(props.value ?? '');

  return (
    <div className="chorus">
      <div data-testid="transcript">{children ?? 'transcript'}</div>
      <ChatInput
        {...props}
        value={value}
        onChange={setValue}
        onSend={props.onSend ?? vi.fn()}
      />
    </div>
  );
}

export function fileTransfer(...files: File[]) {
  return {
    files,
    items: files.map(file => ({ kind: 'file', getAsFile: () => file })),
    types: ['Files'],
  };
}

export async function dropFiles(target: Element, ...files: File[]) {
  await act(async () => {
    fireEvent.drop(target, { dataTransfer: fileTransfer(...files) });
  });
}

export async function pasteFiles(target: Element, ...files: File[]) {
  await act(async () => {
    fireEvent.paste(target, { clipboardData: fileTransfer(...files) });
  });
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type FileReaderHandler = ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null;

export function installDeferredFileReader() {
  const OriginalFileReader = globalThis.FileReader;
  const readers: DeferredFileReader[] = [];

  class DeferredFileReader {
    static EMPTY = 0;
    static LOADING = 1;
    static DONE = 2;

    readyState = DeferredFileReader.EMPTY;
    result: string | ArrayBuffer | null = null;
    error: DOMException | null = null;
    onload: FileReaderHandler = null;
    onerror: FileReaderHandler = null;
    onabort: FileReaderHandler = null;

    constructor() {
      readers.push(this);
    }

    readAsDataURL() {
      this.readyState = DeferredFileReader.LOADING;
    }

    abort() {
      this.readyState = DeferredFileReader.DONE;
      this.onabort?.call(this as unknown as FileReader, new ProgressEvent('abort') as ProgressEvent<FileReader>);
    }

    resolve(dataUrl: string) {
      this.result = dataUrl;
      this.readyState = DeferredFileReader.DONE;
      this.onload?.call(this as unknown as FileReader, new ProgressEvent('load') as ProgressEvent<FileReader>);
    }

    reject(error = new DOMException('read failed', 'NotReadableError')) {
      this.error = error;
      this.readyState = DeferredFileReader.DONE;
      this.onerror?.call(this as unknown as FileReader, new ProgressEvent('error') as ProgressEvent<FileReader>);
    }
  }

  Object.defineProperty(globalThis, 'FileReader', {
    configurable: true,
    writable: true,
    value: DeferredFileReader as unknown as typeof FileReader,
  });

  return {
    readers,
    restore() {
      Object.defineProperty(globalThis, 'FileReader', {
        configurable: true,
        writable: true,
        value: OriginalFileReader,
      });
    },
  };
}
