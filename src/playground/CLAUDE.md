# Playground folder

This directory is demo-only code for the Vite playground. It is not part of the react-chorus public library API or package exports; keep app shell, mock transport, demo data, and playground-only styles here.

Shared tab helpers such as `tabs/weatherFixtures.ts`, `tabs/promptIntent.ts`, `tabs/openAIChunkBuilders.ts`, and `tabs/demoStreamPlan.ts` are playground-only fixtures for mock transports. Import them directly from playground tabs; do not route them through library barrels or package exports.
