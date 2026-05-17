import express from 'express';
import OpenAI from 'openai';
import { toOpenAIChatCompletionsBody } from 'react-chorus/provider-requests';
import { formatSSEDone, formatSSEError, formatSSEEvent, sseHeaders } from 'react-chorus/server';

const app = express();
const openai = new OpenAI(); // reads OPENAI_API_KEY from environment; keep it server-side

app.use(express.json({ limit: '10mb' }));

app.post('/api/chat', async (req, res) => {
  // Chorus POSTs `{ prompt, history }`. `history` already includes the new user
  // turn — do not also append `req.body.prompt`, or the latest message will be
  // sent to the model twice. `prompt` is only a convenience copy for backends
  // that prefer to read the new turn as a separate field.
  const history = Array.isArray(req.body?.history) ? req.body.history : [];
  const controller = new AbortController();
  req.on('close', () => controller.abort());

  res.writeHead(200, sseHeaders);

  try {
    const stream = await openai.chat.completions.create(
      toOpenAIChatCompletionsBody(history, { model: 'gpt-4o-mini' }),
      { signal: controller.signal },
    );

    for await (const chunk of stream) {
      res.write(formatSSEEvent(chunk));
    }

    if (!controller.signal.aborted) {
      res.write(formatSSEDone());
    }
  } catch (err) {
    if (!controller.signal.aborted) {
      res.write(formatSSEError(err));
    }
  } finally {
    res.end();
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend listening on http://localhost:${PORT}`));
