import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Form, FormBlock } from '../../blocks/Form';
import type { FormField, FormProps } from '../../blocks/Form';
import type { BlockEmit, BlockRenderProps } from '../../blocks/types';

/**
 * Build the `BlockRenderProps` the renderer injects. The `Form` component
 * reads `fields` from the spread props, not from `props`, so an empty `props`
 * object here just mirrors the very first `__render_block` delta.
 */
function renderProps(emit: BlockEmit = () => undefined): BlockRenderProps<FormProps> {
  return { props: {}, streaming: true, emit };
}

describe('Form block — streamed default-prop sync', () => {
  it('applies field defaults that arrive in a later streamed delta and submits them', async () => {
    const user = userEvent.setup();
    const emit = vi.fn();

    // First delta: props are still empty, so no fields render yet.
    const { rerender } = render(<Form {...renderProps(emit)} />);
    expect(screen.queryByRole('button', { name: 'Submit' })).toBeInTheDocument();
    expect(screen.queryByLabelText('City')).toBeNull();

    // Later delta: fields + defaults arrive.
    const fields: FormField[] = [
      { name: 'city', label: 'City', default: 'SF' },
      { name: 'guests', label: 'Guests', type: 'number', default: 2 },
    ];
    rerender(<Form {...renderProps(emit)} fields={fields} />);

    expect(screen.getByLabelText('City')).toHaveValue('SF');
    expect(screen.getByLabelText('Guests')).toHaveValue(2);

    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(emit).toHaveBeenCalledWith({
      toolCall: { name: '__form_submitted', input: { city: 'SF', guests: 2 } },
    });
  });

  it('preserves a user edit when a later delta changes that field default', async () => {
    const user = userEvent.setup();
    const emit = vi.fn();
    const f1: FormField[] = [{ name: 'city', label: 'City', default: 'SF' }];
    const { rerender } = render(<Form {...renderProps(emit)} fields={f1} />);

    const input = screen.getByLabelText('City');
    await user.clear(input);
    await user.type(input, 'NYC');
    expect(input).toHaveValue('NYC');

    // A later delta changes the default for the same field; the active edit
    // must win over the freshly-streamed default.
    const f2: FormField[] = [{ name: 'city', label: 'City', default: 'LA' }];
    rerender(<Form {...renderProps(emit)} fields={f2} />);
    expect(screen.getByLabelText('City')).toHaveValue('NYC');

    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(emit).toHaveBeenCalledWith({
      toolCall: { name: '__form_submitted', input: { city: 'NYC' } },
    });
  });

  it('adds new fields with their defaults and drops removed fields from the payload', async () => {
    const user = userEvent.setup();
    const emit = vi.fn();
    const f1: FormField[] = [
      { name: 'name', label: 'Name', default: 'Ada' },
      { name: 'temp', label: 'Temp', default: 'remove-me' },
    ];
    const { rerender } = render(<Form {...renderProps(emit)} fields={f1} />);
    expect(screen.getByLabelText('Temp')).toBeInTheDocument();

    // Later delta: `temp` removed, `email` added with a default.
    const f2: FormField[] = [
      { name: 'name', label: 'Name', default: 'Ada' },
      { name: 'email', label: 'Email', type: 'email', default: 'a@b.co' },
    ];
    rerender(<Form {...renderProps(emit)} fields={f2} />);

    expect(screen.queryByLabelText('Temp')).toBeNull();
    expect(screen.getByLabelText('Email')).toHaveValue('a@b.co');

    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(emit).toHaveBeenCalledWith({
      toolCall: { name: '__form_submitted', input: { name: 'Ada', email: 'a@b.co' } },
    });
  });

  it('re-adding a removed field restores its default instead of a stale edit', async () => {
    const user = userEvent.setup();
    const emit = vi.fn();
    const withField: FormField[] = [{ name: 'note', label: 'Note', default: 'hi' }];
    const { rerender } = render(<Form {...renderProps(emit)} fields={withField} />);

    const input = screen.getByLabelText('Note');
    await user.clear(input);
    await user.type(input, 'edited');
    expect(input).toHaveValue('edited');

    // Field disappears, then comes back: the stale edit must not resurrect.
    rerender(<Form {...renderProps(emit)} fields={[]} />);
    expect(screen.queryByLabelText('Note')).toBeNull();

    rerender(<Form {...renderProps(emit)} fields={withField} />);
    expect(screen.getByLabelText('Note')).toHaveValue('hi');
  });

  it('exports FormBlock with the Form component', () => {
    expect(FormBlock.component).toBe(Form);
  });
});
