import express from 'express';
import OpenAI from 'openai';

const app = express();
const openai = new OpenAI(); // reads OPENAI_API_KEY from environment

app.use(express.json());

app.post('/api/chat', async (req, res) => {
  const { history = [] } = req.body;
  const messages = history.map((m) => ({ role: m.role, content: m.text }));

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const stream = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      stream: true,
    });

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
