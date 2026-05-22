import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ASST_MSG,
  ChatWindow,
  MessageBubble,
  SYS_MSG,
  TOOL_MSG,
  USER_MSG,
  readmeMessageRenderer,
  type Message,
} from './testUtils';

// Mock Markdown to avoid DOMPurify/highlight.js complexity in unit tests.
vi.mock('../../components/Markdown', () => ({
  Markdown: ({ text, headless, streaming, sanitizer }: { text: string; headless?: boolean; streaming?: boolean; sanitizer?: unknown }) => (
    <span data-testid="markdown" data-headless={String(headless)} data-streaming={String(streaming)} data-sanitizer={String(Boolean(sanitizer))}>{text}</span>
  ),
}));

describe('ChatWindow renderMessage and message actions', () => {
  it('uses renderMessage prop to override default rendering', () => {
    const renderMessage = vi.fn((m: Message) => (
      <div data-testid="custom">{m.text}</div>
    ));
    render(<ChatWindow messages={[USER_MSG]} renderMessage={renderMessage} />);
    expect(screen.getByTestId('custom')).toHaveTextContent('Hello');
    expect(renderMessage.mock.calls[0][0]).toBe(USER_MSG);
    expect(renderMessage.mock.calls[0][1]).toEqual(expect.objectContaining({
      isStreaming: false,
      defaultRender: expect.any(Function),
      actions: expect.any(Object),
      messageProps: { 'data-chorus-message-id': 'u1' },
    }));
  });
  it('adds scroll target props to a direct custom DOM renderMessage root', () => {
    render(
      <ChatWindow
        messages={[USER_MSG]}
        renderMessage={(message) => <article data-testid="custom-root">{message.text}</article>}
      />
    );

    expect(screen.getByTestId('custom-root')).toHaveAttribute('data-chorus-message-id', 'u1');
  });
  it('falls back to default rendering when renderMessage returns null', () => {
    const renderMessage = vi.fn(() => null);
    render(<ChatWindow messages={[USER_MSG]} renderMessage={renderMessage} />);
    // Falls back to the default MessageRow render
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });
  it('provides renderMessage context for streaming state, default rendering, and actions', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    const renderMessage = vi.fn((_message: Message, ctx) => (
      <div>
        <span data-testid="streaming-state">{String(ctx.isStreaming)}</span>
        {ctx.defaultRender()}
        <button type="button" onClick={ctx.actions.delete}>Custom delete</button>
      </div>
    ));

    render(<ChatWindow messages={[ASST_MSG]} streamingMessageId="a1" renderMessage={renderMessage} onDelete={onDelete} />);

    expect(screen.getByTestId('streaming-state')).toHaveTextContent('true');
    expect(screen.getByText('Hi there')).toBeInTheDocument();
    expect(screen.getByTestId('markdown')).toHaveAttribute('data-streaming', 'true');

    await user.click(screen.getByRole('button', { name: 'Custom delete' }));

    expect(onDelete).toHaveBeenCalledWith('a1');
  });
  it('names all message action controls and the edit textarea', async () => {
    const user = userEvent.setup();
    render(
      <ChatWindow
        messages={[USER_MSG, ASST_MSG]}
        onEdit={vi.fn()}
        onRegenerate={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Edit' }));

    expect(screen.getByRole('textbox', { name: 'Edit message' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });
  it('calls onDelete with message id when delete button is clicked', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(<ChatWindow messages={[USER_MSG]} onDelete={onDelete} />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith('u1');
  });
  it('calls onRegenerate with message id when regenerate is clicked', async () => {
    const user = userEvent.setup();
    const onRegenerate = vi.fn();
    render(<ChatWindow messages={[ASST_MSG]} onRegenerate={onRegenerate} />);
    await user.click(screen.getByRole('button', { name: 'Regenerate' }));
    expect(onRegenerate).toHaveBeenCalledWith('a1');
  });
  it('preserves local edit state when messages stream in', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const { rerender } = render(<ChatWindow messages={[USER_MSG, { ...ASST_MSG, text: 'H' }]} onEdit={onEdit} />);

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.type(screen.getByRole('textbox', { name: 'Edit message' }), ' draft');

    rerender(<ChatWindow messages={[USER_MSG, { ...ASST_MSG, text: 'Hi there streaming' }]} onEdit={onEdit} />);

    expect(screen.getByRole('textbox', { name: 'Edit message' })).toHaveValue('Hello draft');
  });
  it('renders identical inline editor markup in default and renderMessage action paths', async () => {
    const user = userEvent.setup();
    const defaultView = render(<ChatWindow messages={[USER_MSG]} onEdit={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const defaultMarkup = defaultView.container.querySelector('.chorus-edit-wrap')?.outerHTML;
    defaultView.unmount();

    const customView = render(<ChatWindow messages={[USER_MSG]} onEdit={vi.fn()} renderMessage={readmeMessageRenderer} />);
    await user.click(screen.getByRole('button', { name: 'Edit' }));

    expect(customView.container.querySelector('.chorus-edit-wrap')?.outerHTML).toBe(defaultMarkup);
  });
  for (const variant of [
    { name: 'default row', renderMessage: undefined },
    { name: 'renderMessage action controls', renderMessage: readmeMessageRenderer },
  ] as const) {
    it(`handles Enter, Escape, and Shift+Enter identically in the ${variant.name} editor`, () => {
      const onEdit = vi.fn();
      render(<ChatWindow messages={[USER_MSG]} onEdit={onEdit} renderMessage={variant.renderMessage} />);

      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
      const textarea = screen.getByRole('textbox', { name: 'Edit message' });
      fireEvent.change(textarea, { target: { value: 'Line 1\nLine 2' } });
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

      expect(textarea).toHaveValue('Line 1\nLine 2');
      expect(onEdit).not.toHaveBeenCalled();

      fireEvent.keyDown(textarea, { key: 'Escape' });
      expect(screen.queryByRole('textbox', { name: 'Edit message' })).not.toBeInTheDocument();
      expect(onEdit).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
      const saveTextarea = screen.getByRole('textbox', { name: 'Edit message' });
      fireEvent.change(saveTextarea, { target: { value: 'Saved' } });
      fireEvent.keyDown(saveTextarea, { key: 'Enter' });

      expect(onEdit).toHaveBeenCalledWith('u1', 'Saved');
      expect(screen.queryByRole('textbox', { name: 'Edit message' })).not.toBeInTheDocument();
    });

    it(`trims edit input before calling onEdit and cancels all-whitespace edits in the ${variant.name}`, () => {
      const onEdit = vi.fn();
      render(<ChatWindow messages={[USER_MSG]} onEdit={onEdit} renderMessage={variant.renderMessage} />);

      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
      fireEvent.change(screen.getByRole('textbox', { name: 'Edit message' }), { target: { value: '  hello  ' } });
      fireEvent.keyDown(screen.getByRole('textbox', { name: 'Edit message' }), { key: 'Enter' });

      expect(onEdit).toHaveBeenCalledTimes(1);
      expect(onEdit).toHaveBeenCalledWith('u1', 'hello');

      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
      fireEvent.change(screen.getByRole('textbox', { name: 'Edit message' }), { target: { value: '   ' } });
      fireEvent.keyDown(screen.getByRole('textbox', { name: 'Edit message' }), { key: 'Enter' });

      // An all-whitespace edit cancels instead of firing onEdit a second time.
      expect(onEdit).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('textbox', { name: 'Edit message' })).not.toBeInTheDocument();
    });

    it(`does not submit on Enter while an IME candidate is composing in the ${variant.name}`, () => {
      const onEdit = vi.fn();
      render(<ChatWindow messages={[USER_MSG]} onEdit={onEdit} renderMessage={variant.renderMessage} />);

      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
      const textarea = screen.getByRole('textbox', { name: 'Edit message' });
      fireEvent.change(textarea, { target: { value: 'にほんご' } });

      // Enter pressed to confirm an IME candidate: isComposing true / keyCode 229.
      fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true });
      fireEvent.keyDown(textarea, { key: 'Enter', keyCode: 229 });
      expect(onEdit).not.toHaveBeenCalled();
      expect(textarea).toBeInTheDocument();

      // A plain Enter on the now-committed text submits.
      fireEvent.keyDown(textarea, { key: 'Enter' });
      expect(onEdit).toHaveBeenCalledWith('u1', 'にほんご');
    });

    it(`stops Escape from propagating to ancestor handlers in the ${variant.name}`, () => {
      const onEdit = vi.fn();
      const ancestorEscape = vi.fn();
      render(
        <div onKeyDown={e => { if (e.key === 'Escape') ancestorEscape(); }}>
          <ChatWindow messages={[USER_MSG]} onEdit={onEdit} renderMessage={variant.renderMessage} />
        </div>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
      fireEvent.keyDown(screen.getByRole('textbox', { name: 'Edit message' }), { key: 'Escape' });

      expect(screen.queryByRole('textbox', { name: 'Edit message' })).not.toBeInTheDocument();
      expect(ancestorEscape).not.toHaveBeenCalled();
      expect(onEdit).not.toHaveBeenCalled();
    });
  }
  it('supports the README MessageBubble plus actions.defaultRender pattern without duplicate bubbles', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onRegenerate = vi.fn();
    const onDelete = vi.fn();
    render(
      <ChatWindow
        messages={[USER_MSG, ASST_MSG]}
        onEdit={onEdit}
        onRegenerate={onRegenerate}
        onDelete={onDelete}
        renderMessage={readmeMessageRenderer}
      />
    );

    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Regenerate' }));
    await user.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
    await user.click(screen.getByRole('button', { name: 'Edit' }));

    expect(onRegenerate).toHaveBeenCalledWith('a1');
    expect(onDelete).toHaveBeenCalledWith('u1');
    expect(screen.getByRole('textbox', { name: 'Edit message' })).toHaveValue('Hello');
    expect(screen.queryAllByTestId('markdown').map(el => el.textContent)).not.toContain('Hello');
  });
  for (const variant of [
    { name: 'default row', renderMessage: undefined },
    { name: 'renderMessage action controls', renderMessage: readmeMessageRenderer },
  ] as const) {
    it(`restores focus to the Edit button after Escape in the ${variant.name}`, async () => {
      const user = userEvent.setup();
      render(<ChatWindow messages={[USER_MSG]} onEdit={vi.fn()} renderMessage={variant.renderMessage} />);

      await user.click(screen.getByRole('button', { name: 'Edit' }));
      await user.keyboard('{Escape}');

      expect(screen.queryByRole('textbox', { name: 'Edit message' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus();
    });

    it(`restores focus to the Edit button after Cancel click in the ${variant.name}`, async () => {
      const user = userEvent.setup();
      render(<ChatWindow messages={[USER_MSG]} onEdit={vi.fn()} renderMessage={variant.renderMessage} />);

      await user.click(screen.getByRole('button', { name: 'Edit' }));
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(screen.queryByRole('textbox', { name: 'Edit message' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus();
    });
  }
  it('exposes ctx.isEditing so custom rows can hide their own content while the editor is active', async () => {
    const user = userEvent.setup();
    render(
      <ChatWindow
        messages={[USER_MSG]}
        onEdit={vi.fn()}
        renderMessage={(msg, ctx) => (
          <div {...ctx.messageProps}>
            {!ctx.isEditing && <p data-testid="custom-text">{msg.text}</p>}
            {ctx.actions.defaultRender()}
          </div>
        )}
      />
    );

    expect(screen.getByTestId('custom-text')).toHaveTextContent('Hello');

    await user.click(screen.getByRole('button', { name: 'Edit' }));

    expect(screen.queryByTestId('custom-text')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Edit message' })).toHaveValue('Hello');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByTestId('custom-text')).toHaveTextContent('Hello');
    expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus();
  });
  it('MessageBubble preserves the default row layout when used from renderMessage', () => {
    const { container } = render(
      <ChatWindow
        messages={[USER_MSG]}
        renderMessage={(message) => <MessageBubble message={message} />}
      />
    );

    const bubble = container.querySelector('.chorus-msg.chorus-user > .chorus-msg-content > .chorus-bubble');
    expect(bubble).toHaveTextContent('Hello');
  });
  it('adds screen-reader speaker labels to built-in rows and exported MessageBubble', () => {
    const { container, unmount } = render(<ChatWindow messages={[USER_MSG, ASST_MSG, SYS_MSG, TOOL_MSG]} hiddenRoles={[]} />);
    expect(Array.from(container.querySelectorAll('.chorus-msg > .chorus-sr-only')).map(el => el.textContent)).toEqual([
      'User message',
      'Assistant message',
      'System message',
      'Tool message',
    ]);
    unmount();

    const bubbleView = render(<MessageBubble message={USER_MSG} />);
    expect(bubbleView.container.querySelector('.chorus-msg > .chorus-sr-only')).toHaveTextContent('User message');
  });
  it('renders MessageBubble decoration slots in the expected layout positions', () => {
    const { container } = render(
      <MessageBubble
        message={ASST_MSG}
        before={<span data-testid="before">Avatar</span>}
        headerSlot={<span data-testid="header">Assistant · 14:32</span>}
        footerSlot={<span data-testid="footer">gpt-4o</span>}
        after={<span data-testid="after">Status</span>}
      />
    );

    const row = container.querySelector('.chorus-msg')!;
    const content = row.querySelector('.chorus-msg-content')!;
    expect(row.querySelector('[data-testid="before"]')?.nextElementSibling).toBe(content);
    expect(content.firstElementChild).toHaveAttribute('data-testid', 'header');
    expect(content.querySelector('.chorus-bubble')?.nextElementSibling).toHaveAttribute('data-testid', 'footer');
    expect(content.nextElementSibling).toHaveAttribute('data-testid', 'after');
  });
  it('passes decoration slots through ctx.defaultRender', () => {
    render(
      <ChatWindow
        messages={[USER_MSG]}
        renderMessage={(_message, ctx) => ctx.defaultRender({
          headerSlot: <span data-testid="ctx-header">You · now</span>,
          footerSlot: <span data-testid="ctx-footer">sent</span>,
        })}
      />
    );

    expect(screen.getByTestId('ctx-header')).toHaveTextContent('You · now');
    expect(screen.getByTestId('ctx-footer')).toHaveTextContent('sent');
  });
  it('exposes sources on renderMessage context while defaultRender still renders them', () => {
    const sourced: Message = {
      ...ASST_MSG,
      sources: [{ id: 'src1', title: 'API docs', url: 'https://docs.example.com/api' }],
    };
    const renderMessage = vi.fn((_message: Message, ctx) => (
      <div>
        <span data-testid="source-count">{ctx.sources.length}</span>
        {ctx.defaultRender()}
      </div>
    ));

    render(<ChatWindow messages={[sourced]} renderMessage={renderMessage} />);

    expect(screen.getByTestId('source-count')).toHaveTextContent('1');
    expect(screen.getByRole('link', { name: 'API docs' })).toHaveAttribute('href', 'https://docs.example.com/api');
  });
  it('passes decoration slots through ctx.defaultRender for a tool message', () => {
    const { container } = render(
      <ChatWindow
        messages={[TOOL_MSG]}
        hiddenRoles={[]}
        renderMessage={(_message, ctx) => ctx.defaultRender({
          headerSlot: <span data-testid="tool-ctx-header">search · now</span>,
          footerSlot: <span data-testid="tool-ctx-footer">done</span>,
        })}
      />
    );

    expect(screen.getByTestId('tool-ctx-header')).toHaveTextContent('search · now');
    expect(screen.getByTestId('tool-ctx-footer')).toHaveTextContent('done');

    // Mirror MessageBubbleLayout ordering: headerSlot before the tool call, footerSlot after.
    const toolCall = container.querySelector('.chorus-tool .chorus-tool-call')!;
    expect(toolCall.previousElementSibling).toHaveAttribute('data-testid', 'tool-ctx-header');
    expect(toolCall.nextElementSibling).toHaveAttribute('data-testid', 'tool-ctx-footer');
  });
  it('flips ctx.isEditing when Edit is clicked on a row from ctx.defaultRender()', async () => {
    const user = userEvent.setup();
    render(
      <ChatWindow
        messages={[USER_MSG]}
        onEdit={vi.fn()}
        renderMessage={(msg, ctx) => (
          <div {...ctx.messageProps}>
            {!ctx.isEditing && <p data-testid="custom-text">{msg.text}</p>}
            {ctx.defaultRender()}
          </div>
        )}
      />
    );

    expect(screen.getByTestId('custom-text')).toHaveTextContent('Hello');

    await user.click(screen.getByRole('button', { name: 'Edit' }));

    expect(screen.queryByTestId('custom-text')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Edit message' })).toHaveValue('Hello');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByTestId('custom-text')).toHaveTextContent('Hello');
  });
  it('MessageBubble renders message attachments', () => {
    const message: Message = {
      id: 'u2',
      role: 'user',
      text: 'See attachments',
      attachments: [
        { name: 'photo.png', type: 'image/png', data: 'data:image/png;base64,abc', size: 3 },
        { name: 'notes.txt', type: 'text/plain', data: 'data:text/plain;base64,abc', size: 3 },
      ],
    };

    const { container } = render(<MessageBubble message={message} />);

    expect(screen.getByAltText('Attached image: photo.png')).toHaveAttribute('src', 'data:image/png;base64,abc');
    expect(screen.getByAltText('Attached image: photo.png')).toHaveAttribute('loading', 'lazy');
    expect(screen.getByAltText('Attached image: photo.png')).toHaveAttribute('decoding', 'async');
    expect(screen.getByText('notes.txt')).toBeInTheDocument();
    expect(container.querySelector('.chorus-msg-attachments')).toBeInTheDocument();
  });
  it('MessageBubble forwards headless to Markdown', () => {
    render(<MessageBubble message={USER_MSG} headless />);
    expect(screen.getByTestId('markdown')).toHaveAttribute('data-headless', 'true');
  });
  it('forwards Markdown customisation props to the built-in renderer', () => {
    const sanitizer = vi.fn((html: string) => html);
    render(<ChatWindow messages={[USER_MSG]} markdownSanitizer={sanitizer} />);
    expect(screen.getByTestId('markdown')).toHaveAttribute('data-sanitizer', 'true');
  });
  it('warns in dev when renderMessage returns a non-self-tagging custom component root', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    function HostRow({ text }: { text: string }) {
      return <p data-testid="host-row">{text}</p>;
    }
    render(
      <ChatWindow
        messages={[USER_MSG]}
        renderMessage={(message) => <HostRow text={message.text} />}
      />
    );

    // The custom component swallows messageProps, so the scroll target is lost.
    expect(screen.getByTestId('host-row')).not.toHaveAttribute('data-chorus-message-id');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ChorusRef.scrollToMessage'));
    warn.mockRestore();
  });
  it('does not warn when renderMessage returns the self-tagging README MessageBubble + Fragment pattern', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<ChatWindow messages={[USER_MSG]} renderMessage={readmeMessageRenderer} />);

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
  it('auto-resizes the inline message editor textarea to fit its content', async () => {
    const user = userEvent.setup();
    render(<ChatWindow messages={[USER_MSG]} onEdit={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const textarea = screen.getByRole('textbox', { name: 'Edit message' });
    // jsdom performs no layout, so feed a deterministic content height.
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 140 });
    await user.type(textarea, ' more');

    expect(textarea).toHaveStyle({ height: '140px' });
  });
  it('caps the inline message editor textarea height for very long content', async () => {
    const user = userEvent.setup();
    render(<ChatWindow messages={[USER_MSG]} onEdit={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const textarea = screen.getByRole('textbox', { name: 'Edit message' });
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 5000 });
    await user.type(textarea, ' more');

    expect(textarea).toHaveStyle({ height: '320px' });
  });
});
