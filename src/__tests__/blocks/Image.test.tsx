import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Image, ImageBlock, createImageBlock } from '../../blocks/Image';
import type { BlockRenderProps } from '../../blocks/types';

function renderImage(props: Parameters<typeof Image>[0]) {
  return render(<Image {...props} />);
}

function defaultRenderProps(): BlockRenderProps<unknown> {
  return { props: {}, streaming: false, emit: () => undefined };
}

/**
 * Render a packaged block definition's component exactly the way `BlockRenderer`
 * does: spread the model-emitted props alongside the injected runtime props.
 * `rawProps` simulates what an untrusted model streamed in `__render_block`.
 */
function renderBlock(def: ReturnType<typeof createImageBlock>, rawProps: Record<string, unknown>) {
  const Component = def.component;
  return render(<Component {...(rawProps as Record<string, never>)} {...defaultRenderProps()} />);
}

const BLOCKED_LABEL = 'Blocked image (unsafe URL scheme)';

describe('Image block', () => {
  it('renders an https image with the default whitelist', () => {
    renderImage({ ...defaultRenderProps(), src: 'https://example.com/cat.png', alt: 'cat' });
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://example.com/cat.png');
  });

  it('renders a data:image/png with the default whitelist', () => {
    renderImage({ ...defaultRenderProps(), src: 'data:image/png;base64,iVBORw0KGgo=', alt: 'pixel' });
    expect(screen.getByRole('img')).toHaveAttribute('alt', 'pixel');
  });

  it('blocks http://localhost by default', () => {
    renderImage({ ...defaultRenderProps(), src: 'http://localhost:3000/screenshot.png' });
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText(BLOCKED_LABEL)).toBeInTheDocument();
  });

  it('blocks javascript: URLs under the default whitelist', () => {
    renderImage({ ...defaultRenderProps(), src: 'javascript:alert(1)' });
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText(BLOCKED_LABEL)).toBeInTheDocument();
  });

  it('matches schemes against the parsed protocol, not a raw prefix', () => {
    // `httpsx:` starts with neither `https:` nor anything in the default list,
    // and a lookalike scheme must not slip through.
    renderImage({ ...defaultRenderProps(), src: 'httpsx://evil.example/x.png' });
    expect(screen.queryByRole('img')).toBeNull();
    // A mixed-case scheme still resolves to the canonical protocol and renders.
    renderImage({ ...defaultRenderProps(), src: 'HTTPS://example.com/cat.png', alt: 'cat' });
    expect(screen.getByRole('img')).toHaveAttribute('src', 'HTTPS://example.com/cat.png');
  });

  it('shows a localized blockedLabel when provided directly to Image', () => {
    renderImage({ ...defaultRenderProps(), src: 'javascript:1', blockedLabel: 'Image bloquée (URL non sûre)' });
    expect(screen.getByText('Image bloquée (URL non sûre)')).toBeInTheDocument();
  });

  describe('packaged ImageBlock (safe by default)', () => {
    it('exports a BlockDefinition with a component', () => {
      expect(typeof ImageBlock.component).toBe('function');
    });

    it('renders an https image streamed by the model', () => {
      renderBlock(ImageBlock, { src: 'https://example.com/cat.png', alt: 'cat' });
      expect(screen.getByRole('img')).toHaveAttribute('src', 'https://example.com/cat.png');
    });

    it('ignores a model-streamed allowedProtocols that tries to widen the whitelist', () => {
      // The exploit: an untrusted model emits its own `allowedProtocols` to
      // re-open `http:` / `data:` and slip an unsafe URL past the default gate.
      renderBlock(ImageBlock, {
        src: 'http://evil.example/tracker.png',
        allowedProtocols: ['http:', 'https:', 'data:image/'],
      });
      expect(screen.queryByRole('img')).toBeNull();
      expect(screen.getByText(BLOCKED_LABEL)).toBeInTheDocument();
    });

    it('ignores a model-streamed allowedProtocols that tries to allow javascript:', () => {
      renderBlock(ImageBlock, {
        src: 'javascript:alert(1)',
        allowedProtocols: ['javascript:'],
      });
      expect(screen.queryByRole('img')).toBeNull();
      expect(screen.getByText(BLOCKED_LABEL)).toBeInTheDocument();
    });

    it('ignores a model-streamed blockedLabel so the host policy stays visible', () => {
      // A model that relabels the blocked state to an innocuous-looking caption
      // could hide from the reader that the URL was rejected.
      renderBlock(ImageBlock, {
        src: 'javascript:alert(1)',
        blockedLabel: 'Loading image…',
      });
      expect(screen.getByText(BLOCKED_LABEL)).toBeInTheDocument();
      expect(screen.queryByText('Loading image…')).toBeNull();
    });
  });

  describe('createImageBlock (host-pinned policy)', () => {
    it('honors a host-supplied allowedProtocols list (e.g. http://localhost for dev)', () => {
      const block = createImageBlock({ allowedProtocols: ['https:', 'data:image/', 'http://localhost'] });
      const { container } = renderBlock(block, { src: 'http://localhost:3000/screenshot.png' });
      // The `<img>` has an empty default `alt`, which Testing Library treats as
      // `role="presentation"` rather than `role="img"`. Query by tag so the
      // whitelist assertion exercises the URL gate without requiring a host alt.
      expect(container.querySelector('img')).toHaveAttribute('src', 'http://localhost:3000/screenshot.png');
      expect(screen.queryByText(BLOCKED_LABEL)).not.toBeInTheDocument();
    });

    it('does not let a localhost opt-in match a lookalike host', () => {
      const block = createImageBlock({ allowedProtocols: ['https:', 'data:image/', 'http://localhost'] });
      renderBlock(block, { src: 'http://localhost.evil.com/screenshot.png' });
      expect(screen.queryByRole('img')).toBeNull();
      expect(screen.getByText(BLOCKED_LABEL)).toBeInTheDocument();
    });

    it('does not let a localhost opt-in match a userinfo-spoofed host', () => {
      // `http://localhost@evil.example/...` parses with hostname `evil.example`,
      // not `localhost` — the gate must reject it.
      const block = createImageBlock({ allowedProtocols: ['https:', 'data:image/', 'http://localhost'] });
      renderBlock(block, { src: 'http://localhost@evil.example/x.png' });
      expect(screen.queryByRole('img')).toBeNull();
      expect(screen.getByText(BLOCKED_LABEL)).toBeInTheDocument();
    });

    it('still strips a model-streamed allowedProtocols even with a widened host list', () => {
      const block = createImageBlock({ allowedProtocols: ['https:', 'data:image/', 'http://localhost'] });
      renderBlock(block, {
        src: 'http://evil.example/tracker.png',
        allowedProtocols: ['http:'],
      });
      expect(screen.queryByRole('img')).toBeNull();
      expect(screen.getByText(BLOCKED_LABEL)).toBeInTheDocument();
    });

    it('honors a host-supplied blockedLabel and ignores the model-streamed one', () => {
      const block = createImageBlock({ blockedLabel: 'Image bloquée' });
      renderBlock(block, { src: 'javascript:alert(1)', blockedLabel: 'Loading…' });
      expect(screen.getByText('Image bloquée')).toBeInTheDocument();
      expect(screen.queryByText('Loading…')).toBeNull();
    });

    it('pins a port when the origin entry includes one', () => {
      const block = createImageBlock({ allowedProtocols: ['http://localhost:3000'] });
      const { container } = renderBlock(block, { src: 'http://localhost:3000/ok.png' });
      expect(container.querySelector('img')).toHaveAttribute('src', 'http://localhost:3000/ok.png');

      renderBlock(block, { src: 'http://localhost:9999/blocked.png' });
      expect(screen.getByText(BLOCKED_LABEL)).toBeInTheDocument();
    });

    it('pins a path prefix when the origin entry includes one', () => {
      const block = createImageBlock({ allowedProtocols: ['https://cdn.example.com/imgs/'] });
      const { container } = renderBlock(block, { src: 'https://cdn.example.com/imgs/cat.png' });
      expect(container.querySelector('img')).toHaveAttribute('src', 'https://cdn.example.com/imgs/cat.png');

      renderBlock(block, { src: 'https://cdn.example.com/other/cat.png' });
      expect(screen.getByText(BLOCKED_LABEL)).toBeInTheDocument();
    });
  });
});
