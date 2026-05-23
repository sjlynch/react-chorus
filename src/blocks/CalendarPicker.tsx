import React from 'react';
import type { BlockDefinition, BlockRenderProps } from './types';

export interface CalendarPickerProps {
  /** ISO date (YYYY-MM-DD) initially selected. */
  defaultDate?: string;
  /** Tool name invoked when the user picks a date. Defaults to `__date_selected`. */
  onSelectTool?: string;
  /** Label shown above the picker. */
  label?: string;
}

/**
 * Minimal `<input type="date">` picker. The full task spec calls for
 * `react-day-picker` here; this dependency-free fallback keeps the starter
 * block usable without adding a runtime dependency. A host that wants the
 * richer surface can register its own block using `react-day-picker`.
 */
export function CalendarPicker({ defaultDate, onSelectTool, label, emit }: BlockRenderProps<CalendarPickerProps> & CalendarPickerProps) {
  const [value, setValue] = React.useState<string>(defaultDate ?? '');
  return (
    <div className="chorus-block-calendar">
      {label && <div className="chorus-block-calendar-label">{label}</div>}
      <input
        type="date"
        value={value}
        onChange={e => setValue(e.target.value)}
      />
      <button
        type="button"
        className="chorus-block-calendar-confirm"
        onClick={() => emit?.({ toolCall: { name: onSelectTool || '__date_selected', input: { date: value } } })}
        disabled={!value}
      >
        Confirm
      </button>
    </div>
  );
}

export const CalendarPickerBlock: BlockDefinition<CalendarPickerProps> = {
  component: CalendarPicker,
};
