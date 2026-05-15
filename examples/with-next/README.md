# react-chorus Next.js App Router example

This example runs `<Chorus>` in a Next.js App Router app and proxies OpenAI Chat Completions streaming through `app/api/chat/route.ts`.

```bash
# Build the library from the repository root first
npm run build

cd examples/with-next
npm install
OPENAI_API_KEY=sk-... npm run dev
```

On Windows PowerShell:

```powershell
$env:OPENAI_API_KEY="sk-..."; npm run dev
```

The route exports `runtime = 'nodejs'` because it uses the official OpenAI Node client. Keep API keys server-side and watch request body limits if you enable image attachments; this example caps client-side attachments at 2 MB.
