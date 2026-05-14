import express from 'express';
import OpenAI from 'openai';
import { toOpenAIChatCompletionsBody } from 'react-chorus/provider-requests';

const app = express();
const openai = new OpenAI(); // reads OPENAI_API_KEY from environment; keep it server-side

app.use(express.json({ limit: '10mb' }));

app.post('/api/chat', async (req, res) => {
  const history = Array.isArray(req.body?.history) ? req.body.history : [];

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    const stream = await openai.chat.completions.create(
      toOpenAIChatCompletionsBody(history, { model: 'gpt-4o-mini' }),
    );

    for await (const chunk of stream) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }

    res.write('data: [DONE]\n\n');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
  } finally {
    res.end();
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend listening on http://localhost:${PORT}`));
