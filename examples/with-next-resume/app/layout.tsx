import 'react-chorus/styles.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'react-chorus Next.js server-side resume example',
  description: 'Seed Chorus with a server-fetched transcript via initialMessages and cache follow-up turns under persistenceKey.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif' }}>{children}</body>
    </html>
  );
}
