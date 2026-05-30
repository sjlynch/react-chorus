import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Image, ImageBlock } from '../../blocks/Image';
import type { BlockRenderProps } from '../../blocks/types';

function renderImage(props: Parameters<typeof Image>[0]) {
  return render(<Image {...props} />);
}

function defaultRenderProps(): BlockRenderProps<unknown> {
  return { props: {}, streaming: false, emit: () => undefined };
}

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
    expect(screen.getByText('Blocked image (unsafe URL scheme)')).toBeInTheDocument();
  });

  it('blocks javascript: URLs even when explicitly allowed via the model-supplied list (host wrapper opt-in pattern)', () => {
    // The model can theoretically pass `allowedProtocols`, so hosts must wrap
    // the component to pin the list AFTER the spread of model props. This test
    // simulates the host wrapping pattern.
    function HostImage(props: BlockRenderProps<{ src?: string; allowedProtocols?: string[] }> & { src?: string; allowedProtocols?: string[] }) {
      return <Image {...props} allowedProtocols={['https:', 'data:image/']} />;
    }
    render(<HostImage {...defaultRenderProps()} src="javascript:alert(1)" allowedProtocols={['javascript:']} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('Blocked image (unsafe URL scheme)')).toBeInTheDocument();
  });

  it('honors a host-supplied allowedProtocols list (e.g. http://localhost for dev)', () => {
    renderImage({
      ...defaultRenderProps(),
      src: 'http://localhost:3000/screenshot.png',
      allowedProtocols: ['https:', 'data:image/', 'http://localhost'],
    });
    expect(screen.getByRole('img')).toHaveAttribute('src', 'http://localhost:3000/screenshot.png');
  });

  it('shows a localized blockedLabel when provided', () => {
    renderImage({ ...defaultRenderProps(), src: 'javascript:1', blockedLabel: 'Image bloquée (URL non sûre)' });
    expect(screen.getByText('Image bloquée (URL non sûre)')).toBeInTheDocument();
  });

  it('exports ImageBlock with the Image component', () => {
    expect(ImageBlock.component).toBe(Image);
  });
});
