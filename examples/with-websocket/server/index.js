// Mock Anthropic-over-WebSocket backend for examples/with-websocket.
//
// It speaks the same wire shape as a real Claude proxy would, but generates a
// canned reply so the example runs with no API key. The react-chorus WebSocket
// transport sends `{ prompt, history }` per frame and treats each inbound
// message as one SSE payload, so the `anthropic` connector parses the JSON
// frames below (`content_block_delta` / `message_stop`) unchanged.
//
// To talk to a real model, swap the canned-frame block for the streaming Claude
// backend in the root README ("Minimal Node.js `ws` + Claude backend").
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT) || 8787;
const wss = new WebSocketServer({ port: PORT });

function latestUserText(history) {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const message = history[i];
    if (message && message.role === 'user' && typeof message.text === 'string') {
      return message.text;
    }
  }
  return '';
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let history = [];
    try {
      const parsed = JSON.parse(raw.toString());
      // `history` already includes the new user turn; ignore `parsed.prompt`.
      history = Array.isArray(parsed?.history) ? parsed.history : [];
    } catch {
      // Ignore malformed frames; an empty history still produces a reply.
    }

    const prompt = latestUserText(history);
    const reply = `Streaming a reply over a WebSocket via the anthropic connector. You said: "${prompt}"`;
    const words = reply.split(' ');

    const send = (payload) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
    };

    let index = 0;
    const tick = () => {
      if (ws.readyState !== ws.OPEN) return;
      if (index < words.length) {
        send({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: index === 0 ? words[index] : ` ${words[index]}` },
        });
        index += 1;
        setTimeout(tick, 60);
      } else {
        // `message_stop` is the anthropic connector's done sentinel; the
        // react-chorus WebSocket transport closes the per-send socket after it.
        send({ type: 'message_stop' });
      }
    };
    tick();
  });
});

console.log(`Mock Anthropic WebSocket backend listening on ws://localhost:${PORT}`);
