import express from 'express';
import OpenAI from 'openai';

const app = express();
const openai = new OpenAI(); // reads OPENAI_API_KEY from environment

app.use(express.json({ limit: '10mb' }));

function safeStringify(value) {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function unsupportedAttachmentText(att) {
  const name = typeof att?.name === 'string' ? att.name : 'attachment';
  const type = typeof att?.type === 'string' && att.type ? ` (${att.type})` : '';
  return `[Unsupported attachment omitted: ${name}${type}]`;
}

function userContentParts(message) {
  const text = typeof message.text === 'string' ? message.text : '';
  const parts = [];
  if (text.trim()) parts.push({ type: 'text', text });

  for (const att of Array.isArray(message.attachments) ? message.attachments : []) {
    if (
      typeof att?.type === 'string' &&
      att.type.startsWith('image/') &&
      typeof att.data === 'string' &&
      att.data.startsWith('data:')
    ) {
      parts.push({ type: 'image_url', image_url: { url: att.data } });
    } else {
      parts.push({ type: 'text', text: unsupportedAttachmentText(att) });
    }
  }

  return parts;
}

function toolMessageToSystemText(message) {
  if (message.toolCall) {
    const name = typeof message.toolCall.name === 'string' ? message.toolCall.name : 'tool';
    const input = safeStringify(message.toolCall.input ?? null);
    const output = safeStringify(message.toolCall.output ?? message.text ?? null);
    return `Tool call ${name}\nInput:\n${input}\nOutput:\n${output}`;
  }

  const text = typeof message.text === 'string' ? message.text.trim() : '';
  return text ? `Tool result:\n${text}` : null;
}

function toOpenAIMessage(message) {
  if (!message || typeof message !== 'object') return null;
  const text = typeof message.text === 'string' ? message.text : '';

  if (message.role === 'system') {
    return text.trim() ? { role: 'system', content: text } : null;
  }

  if (message.role === 'assistant') {
    return text.trim() ? { role: 'assistant', content: text } : null;
  }

  if (message.role === 'user') {
    const parts = userContentParts(message);
    if (!parts.length) return null;
    return parts.length === 1 && parts[0].type === 'text'
      ? { role: 'user', content: parts[0].text }
      : { role: 'user', content: parts };
  }

  // react-chorus tool messages do not carry OpenAI's required tool_call_id.
  // Preserve the information as system context instead of sending an invalid
  // `{ role: 'tool' }` message that would make OpenAI reject the request.
  if (message.role === 'tool') {
    const content = toolMessageToSystemText(message);
    return content ? { role: 'system', content } : null;
  }

  return null;
}

app.post('/api/chat', async (req, res) => {
  const { history = [] } = req.body;
  const messages = Array.isArray(history)
    ? history.map(toOpenAIMessage).filter(Boolean)
    : [];

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
