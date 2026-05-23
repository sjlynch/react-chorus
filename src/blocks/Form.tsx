import React from 'react';
import type { BlockDefinition, BlockRenderProps } from './types';

export interface FormField {
  name: string;
  label?: string;
  type?: 'text' | 'number' | 'email' | 'textarea' | 'select' | 'checkbox';
  required?: boolean;
  placeholder?: string;
  options?: Array<{ value: string; label?: string }>;
  default?: unknown;
}

export interface FormProps {
  title?: string;
  fields?: FormField[];
  submitLabel?: string;
  /** Tool name invoked on submit. Defaults to `__form_submitted`. */
  onSubmitTool?: string;
}

function defaultValue(field: FormField): unknown {
  if (field.default !== undefined) return field.default;
  if (field.type === 'checkbox') return false;
  if (field.type === 'number') return 0;
  return '';
}

export function Form({ title, fields, submitLabel, onSubmitTool, emit }: BlockRenderProps<FormProps> & FormProps) {
  const fs = Array.isArray(fields) ? fields : [];
  const [values, setValues] = React.useState<Record<string, unknown>>(() => {
    const init: Record<string, unknown> = {};
    for (const f of fs) init[f.name] = defaultValue(f);
    return init;
  });

  function setField(name: string, value: unknown) {
    setValues(v => ({ ...v, [name]: value }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    emit?.({ toolCall: { name: onSubmitTool || '__form_submitted', input: values } });
  }

  return (
    <form className="chorus-block-form" onSubmit={submit}>
      {title && <div className="chorus-block-form-title">{title}</div>}
      {fs.map(field => (
        <label key={field.name} className="chorus-block-form-field">
          <span className="chorus-block-form-label">{field.label ?? field.name}</span>
          {field.type === 'textarea' ? (
            <textarea
              value={String(values[field.name] ?? '')}
              onChange={e => setField(field.name, e.target.value)}
              placeholder={field.placeholder}
              required={field.required}
            />
          ) : field.type === 'select' ? (
            <select
              value={String(values[field.name] ?? '')}
              onChange={e => setField(field.name, e.target.value)}
              required={field.required}
            >
              {(field.options ?? []).map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label ?? opt.value}</option>
              ))}
            </select>
          ) : field.type === 'checkbox' ? (
            <input
              type="checkbox"
              checked={Boolean(values[field.name])}
              onChange={e => setField(field.name, e.target.checked)}
            />
          ) : (
            <input
              type={field.type === 'number' ? 'number' : field.type === 'email' ? 'email' : 'text'}
              value={String(values[field.name] ?? '')}
              onChange={e => setField(field.name, field.type === 'number' ? Number(e.target.value) : e.target.value)}
              placeholder={field.placeholder}
              required={field.required}
            />
          )}
        </label>
      ))}
      <button type="submit" className="chorus-block-form-submit">{submitLabel ?? 'Submit'}</button>
    </form>
  );
}

export const FormBlock: BlockDefinition<FormProps> = {
  component: Form,
};
