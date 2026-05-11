# react-chorus

Composable chat UI components for React.

## Installation

```bash
npm install react-chorus
```

## Usage

```tsx
import { Chorus } from 'react-chorus';
import 'react-chorus/styles.css';

<Chorus connector={myConnector} />
```

## Bundle size

`highlight.js` (the syntax-highlighting engine used by the `Markdown` component) is ~600 KB minified. To keep initial page load fast, **react-chorus lazy-loads highlight.js at runtime** — it is only fetched the first time a fenced code block (` ``` ` or `~~~`) appears in the rendered text.

**Impact:**
- Pages that never render code blocks pay zero cost — highlight.js is never downloaded.
- Pages that do render code blocks load highlight.js asynchronously on demand. The code renders immediately as plain text and is re-rendered with syntax highlighting once the chunk arrives (typically one extra render, imperceptible during streaming).
- Bundlers (Vite, webpack, Rollup) will automatically split highlight.js into a separate async chunk, so it does not inflate the main bundle.

## Development

```bash
npm run build
```
