import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InlineMessageEditor } from '../components/message-row/InlineMessageEditor';

describe('InlineMessageEditor', () => {
  it('seeds the textarea from initialText', () => {
    render(<InlineMessageEditor initialText="hello" onSubmit={() => undefined} onCancel={() => undefined} />);
    expect(screen.getByRole('textbox')).toHaveValue('hello');
  });

  it('keeps local edits while initialText is unchanged', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <InlineMessageEditor initialText="hello" onSubmit={() => undefined} onCancel={() => undefined} />,
    );
    const textarea = screen.getByRole('textbox');
    await user.clear(textarea);
    await user.type(textarea, 'my draft');
    expect(textarea).toHaveValue('my draft');

    // A re-render with the same initialText must not clobber the in-progress draft.
    rerender(<InlineMessageEditor initialText="hello" onSubmit={() => undefined} onCancel={() => undefined} />);
    expect(screen.getByRole('textbox')).toHaveValue('my draft');
  });

  it('re-syncs the draft when initialText changes underneath an open editor', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <InlineMessageEditor initialText="old text" onSubmit={() => undefined} onCancel={() => undefined} />,
    );
    const textarea = screen.getByRole('textbox');
    await user.clear(textarea);
    await user.type(textarea, 'stale draft');
    expect(textarea).toHaveValue('stale draft');

    // The host rewrites message.text (optimistic correction / regenerate / sync).
    rerender(
      <InlineMessageEditor initialText="newer text" onSubmit={() => undefined} onCancel={() => undefined} />,
    );
    // The unsaved draft is discarded in favor of the newer underlying text.
    expect(screen.getByRole('textbox')).toHaveValue('newer text');
  });

  it('submits the re-synced text, never the stale draft, after an underlying change', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { rerender } = render(
      <InlineMessageEditor initialText="old text" onSubmit={onSubmit} onCancel={() => undefined} />,
    );
    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'stale draft');

    rerender(<InlineMessageEditor initialText="newer text" onSubmit={onSubmit} onCancel={() => undefined} />);

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('newer text');
  });

  it('re-syncs even when the editor was untouched before the underlying change', () => {
    const { rerender } = render(
      <InlineMessageEditor initialText="old text" onSubmit={() => undefined} onCancel={() => undefined} />,
    );
    rerender(<InlineMessageEditor initialText="newer text" onSubmit={() => undefined} onCancel={() => undefined} />);
    expect(screen.getByRole('textbox')).toHaveValue('newer text');
  });
});
