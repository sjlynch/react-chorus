# Out-of-band attachment uploads

A complete, copy-pasteable recipe for attaching **large or non-image files** (PDFs, audio, video, images past a host's body limit) without inlining them as base64 data URLs.

## Why you need this

By default, react-chorus reads accepted files into base64 **data URLs** and stores them in `Message.attachments`. The default `transport` then serializes the whole transcript — data URLs included — into the JSON `history` it POSTs. That is fine for small images and local demos, but base64 inflates a payload by ~33%, and the combined body quickly exceeds real limits:

- **Vercel / serverless route handlers** commonly cap request bodies near **4.5 MB**, and App Router handlers have no `express.json({ limit })` equivalent.
- **Express** defaults to a **100 kB** JSON body unless you raise `express.json({ limit })`.
- Provider APIs reject or truncate oversized requests of their own.

The first real PDF a user drops produces an opaque `413 Payload Too Large`. The fix is to upload the file **out-of-band** — straight to object storage or a provider Files API — and send only a short reference (`url` or `id`) in the chat request.

`uploadAttachment` is the hook for exactly this. It runs per file *before* the attachment enters message history, so the transcript only ever carries the reference, never the bytes.

## How the pieces fit

```
 ┌─ browser ─────────────────┐      ┌─ your server ───────────────┐      ┌─ storage / provider ─┐
 │ <Chorus uploadAttachment> │      │ POST /api/uploads           │      │ S3 / R2 / GCS bucket  │
 │   ── multipart file ──────┼────▶ │  → store the file           ┼────▶ │   or                  │
 │                           │      │  → return { url } or { id } │      │ OpenAI / Anthropic /  │
 │ attachment = { url, id }  │ ◀────┼─────────────────────────────┤      │ Gemini Files API      │
 │                           │      │                             │      └───────────────────────┘
 │ POST /api/chat            │      │ POST /api/chat              │
 │   history carries the     ┼────▶ │  → toOpenAIResponsesBody /  │
 │   reference, not bytes    │      │    toGeminiGenerateContentBody maps it to a provider file ref │
 └───────────────────────────┘      └─────────────────────────────┘
```

## 1. Client — wire up `uploadAttachment`

`uploadAttachment` receives the `File` and an `AbortSignal` (tripped when the user removes a pending chip) and returns an `AttachmentUploadResult`. Return a `url` and/or `id` instead of inline `data`:

```tsx
import { Chorus } from 'react-chorus';

export default function App() {
  return (
    <div style={{ height: '100dvh' }}>
      <Chorus
        transport="/api/chat"
        connector="openai"
        // Accept PDFs and large images, not just small inline ones.
        accept="image/*,application/pdf"
        // Reject anything above 25 MB before it is even uploaded.
        maxAttachmentBytes={25 * 1024 * 1024}
        maxAttachments={4}
        onAttachmentError={(error) => {
          // reason: 'unsupported-type' | 'too-large' | 'too-many' | 'read-failed' | 'upload-failed'
          console.error(error.reason, error.message);
        }}
        uploadAttachment={async (file, { signal } = {}) => {
          const form = new FormData();
          form.set('file', file);

          const res = await fetch('/api/uploads', { method: 'POST', body: form, signal });
          if (!res.ok) {
            // Throwing (or rejecting) surfaces as onAttachmentError reason: 'upload-failed'.
            throw new Error(`Upload failed: ${res.status}`);
          }
          const uploaded = (await res.json()) as { url?: string; fileId?: string };

          return {
            name: file.name,
            type: file.type,
            size: file.size,
            url: uploaded.url,    // object-storage URL — used for previews and `file_url` mapping
            id: uploaded.fileId,  // provider/storage file id — used for `file_id` mapping
            // `data` is intentionally omitted: no base64 ever enters the transcript.
          };
        }}
      />
    </div>
  );
}
```

While `uploadAttachment` is in flight the file shows as a pending chip with an `aria-busy` spinner, Send is disabled, and removing the chip aborts the `signal`. A thrown/rejected upload calls `onAttachmentError` with `reason: 'upload-failed'`; an aborted upload is silent.

If you return only `url` or `id`, Chorus normalizes `attachment.data` to that value for backwards compatibility — but your backend should read the explicit `url` / `id` fields.

## 2. Server — the upload endpoint

Pick whichever target matches how you call the model.

### Option A — object storage (provider-agnostic)

Store the file in a bucket (S3, Cloudflare R2, GCS, …) and return a URL the provider can fetch. This keeps `/api/chat` provider-agnostic.

```js
// server/uploads.js  —  npm install express multer @aws-sdk/client-s3
import express from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // mirror the client `maxAttachmentBytes`
});

const s3 = new S3Client({ region: process.env.AWS_REGION });
const BUCKET = process.env.UPLOADS_BUCKET;
const PUBLIC_BASE = process.env.UPLOADS_PUBLIC_BASE; // e.g. https://cdn.example.com

export function registerUploadRoute(app) {
  app.post('/api/uploads', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file' });

    const key = `chat-uploads/${randomUUID()}/${req.file.originalname}`;
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
    }));

    // Return an absolute URL the model provider can fetch. For a private
    // bucket, return a short-lived presigned GET URL instead.
    res.json({ url: `${PUBLIC_BASE}/${key}` });
  });
}
```

### Option B — a provider Files API (returns a `file_id`)

Upload straight to the model provider so you never host the bytes yourself. Each provider exposes a Files endpoint; the example below uses OpenAI:

```js
// server/uploads.js  —  npm install express multer openai
import express from 'express';
import multer from 'multer';
import OpenAI from 'openai';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const openai = new OpenAI(); // OPENAI_API_KEY from env — keep server-side

export function registerUploadRoute(app) {
  app.post('/api/uploads', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file' });

    // The OpenAI Node SDK accepts a Web `File`; `purpose: 'user_data'` makes
    // the file usable as `input_file` content in the Responses API.
    const file = await openai.files.create({
      file: new File([req.file.buffer], req.file.originalname, { type: req.file.mimetype }),
      purpose: 'user_data',
    });

    res.json({ fileId: file.id }); // -> attachment.id on the client
  });
}
```

Anthropic (`client.beta.files.upload(...)` → a `file_id`) and Gemini (`ai.files.upload(...)` → a file `uri`) expose equivalent endpoints; return their id/uri as `fileId` the same way.

## 3. The chat request — mapping the reference to a provider file

The `/api/chat` proxy keeps the [default `{ prompt, history }` body](guide.md#two-usage-paths). The uploaded attachment now travels in `history` as `{ url?, id?, type, name, size }` — no base64. The provider-request helpers translate that reference into the provider's own file-content shape:

| Provider helper | Reads | Emits | Notes |
|---|---|---|---|
| [`toOpenAIResponsesBody`](guide.md#provider-requestbody-helpers) | `attachment.id`, then `attachment.url` | `{ type: 'input_file', file_id }` or `{ type: 'input_file', file_url }` | The Responses API accepts non-image files (PDFs, etc.) as `input_file`. Use `connector="openai"`. |
| [`toGeminiGenerateContentBody`](guide.md#provider-requestbody-helpers) | an uploaded `url`/`id` | `fileData` (with the attachment's real MIME type) | PDFs, audio, and video all pass through. Upload via the Gemini File API and return its `uri` as the reference. |
| [`toOpenAIChatCompletionsBody`](guide.md#provider-requestbody-helpers) | `attachment.url` (images only) | `image_url` | Chat Completions content has **no** non-image file slot — a PDF falls back to a text note. Use the Responses helper for documents. |
| [`toAnthropicMessagesBody`](guide.md#provider-requestbody-helpers) | `application/pdf` **data URLs** | base64 `document` block | The helper inlines a PDF data URL; it has no slot for an uploaded id. For large PDFs, see the Anthropic note below. |

A Responses-API proxy needs no extra mapping code — the helper does it:

```ts
// app/api/chat/route.ts  —  uploaded files become `input_file` items automatically
import OpenAI from 'openai';
import { toOpenAIResponsesBody } from 'react-chorus/provider-requests';
import { encodeSSEDone, encodeSSEError, encodeSSEEvent, sseHeaders } from 'react-chorus/server';
import type { Message } from 'react-chorus';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const body = (await request.json()) as { history?: Message[] };
        const history = Array.isArray(body.history) ? body.history : [];

        const openai = new OpenAI();
        // Any attachment carrying an uploaded `id`/`url` is mapped to a
        // Responses `input_file` item — no base64, no 413.
        const upstream = await openai.responses.create({
          ...toOpenAIResponsesBody(history, { model: 'gpt-4o-mini' }),
          stream: true,
        });

        for await (const event of upstream) controller.enqueue(encodeSSEEvent(event));
        controller.enqueue(encodeSSEDone());
      } catch (error) {
        if (!request.signal.aborted) controller.enqueue(encodeSSEError(error));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: sseHeaders });
}
```

### Anthropic note

`toAnthropicMessagesBody` inlines an `application/pdf` **data URL** as a base64 `document` block — which still costs request-body bytes, so it only suits modest PDFs. For a large PDF, upload it through the [Anthropic Files API](https://docs.anthropic.com) on the server, then build the `document` block yourself from the returned `file_id` before calling `client.messages.stream(...)`:

```js
const base = toAnthropicMessagesBody(history, { model: 'claude-sonnet-4-6', max_tokens: 1024 });

// Replace the last user turn's content with a Files-API document reference.
const lastUser = base.messages.at(-1);
if (lastUser?.role === 'user' && uploadedFileId) {
  lastUser.content = [
    { type: 'document', source: { type: 'file', file_id: uploadedFileId } },
    { type: 'text', text: typeof lastUser.content === 'string' ? lastUser.content : '' },
  ];
}

const stream = await client.messages.stream(base, { signal });
```

## Summary

- Set `accept` to include the non-image types you want, and `maxAttachmentBytes` to a sane ceiling.
- `uploadAttachment` POSTs each file to `/api/uploads` and returns `{ url }` and/or `{ id }` — never `data`.
- `/api/uploads` stores the file (object storage or a provider Files API) and returns the reference.
- The `/api/chat` proxy maps the reference with `toOpenAIResponsesBody` / `toGeminiGenerateContentBody`; for large Anthropic PDFs, build the Files-API `document` block yourself.

The transcript and every chat request now carry a few-hundred-byte reference instead of megabytes of base64 — no `413`, no host body-limit tuning.
