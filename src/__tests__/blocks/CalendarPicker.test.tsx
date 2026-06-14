import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CalendarPicker, CalendarPickerBlock } from '../../blocks/CalendarPicker';
import type { CalendarPickerProps } from '../../blocks/CalendarPicker';
import type { BlockEmit, BlockRenderProps } from '../../blocks/types';

function renderProps(emit: BlockEmit = () => undefined): BlockRenderProps<CalendarPickerProps> {
  return { props: {}, streaming: true, emit };
}

function dateInput(): HTMLInputElement {
  return document.querySelector('input[type="date"]') as HTMLInputElement;
}

describe('CalendarPicker block — streamed defaultDate sync', () => {
  it('populates from a defaultDate that arrives in a later streamed delta', async () => {
    const user = userEvent.setup();
    const emit = vi.fn();

    // First delta: no defaultDate yet, so the picker is empty and Confirm is disabled.
    const { rerender } = render(<CalendarPicker {...renderProps(emit)} />);
    expect(dateInput().value).toBe('');
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();

    // Later delta: defaultDate arrives and seeds the picker.
    rerender(<CalendarPicker {...renderProps(emit)} defaultDate="2026-06-20" />);
    expect(dateInput().value).toBe('2026-06-20');

    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(emit).toHaveBeenCalledWith({
      toolCall: { name: '__date_selected', input: { date: '2026-06-20' } },
    });
  });

  it('keeps following defaultDate across deltas until the user picks a date', () => {
    const emit = vi.fn();
    const { rerender } = render(<CalendarPicker {...renderProps(emit)} defaultDate="2026-06-20" />);
    expect(dateInput().value).toBe('2026-06-20');

    // A corrected default in a later delta still updates the un-edited picker.
    rerender(<CalendarPicker {...renderProps(emit)} defaultDate="2026-06-21" />);
    expect(dateInput().value).toBe('2026-06-21');
  });

  it('stops following defaultDate once the user picks a date', () => {
    const emit = vi.fn();
    const { rerender } = render(<CalendarPicker {...renderProps(emit)} defaultDate="2026-06-20" />);

    fireEvent.change(dateInput(), { target: { value: '2026-07-01' } });
    expect(dateInput().value).toBe('2026-07-01');

    // A later delta changes defaultDate; the user's selection is preserved.
    rerender(<CalendarPicker {...renderProps(emit)} defaultDate="2026-08-15" />);
    expect(dateInput().value).toBe('2026-07-01');
  });

  it('exports CalendarPickerBlock with the CalendarPicker component', () => {
    expect(CalendarPickerBlock.component).toBe(CalendarPicker);
  });
});
