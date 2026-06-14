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

/**
 * Signature of the fields that should trigger a re-sync of local state.
 * Captures each field's name, type, and current default so that defaults
 * arriving in later `__render_block` deltas (or fields being added/removed)
 * are detected, while a re-render that does not change the field shape is a
 * no-op. Order is included so a reordered field list re-syncs too.
 */
function fieldsSignature(fs: FormField[]): string {
  try {
    return JSON.stringify(fs.map(f => [f.name, f.type ?? 'text', f.default]));
  } catch {
    // Non-serializable default (function, circular). Fall back to a coarse
    // signature so reconciliation still runs when the field set changes.
    return fs.map(f => `${f.name}:${f.type ?? 'text'}`).join('|');
  }
}

/**
 * Rebuild `values` for the current `fields`: new fields take their current
 * default, fields the user has edited keep their value, and fields that are
 * no longer present are dropped.
 */
function reconcileValues(
  prev: Record<string, unknown>,
  fs: FormField[],
  dirty: Record<string, true>,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const f of fs) {
    next[f.name] = dirty[f.name] && f.name in prev ? prev[f.name] : defaultValue(f);
  }
  return next;
}

export function Form({ title, fields, submitLabel, onSubmitTool, emit }: BlockRenderProps<FormProps> & FormProps) {
  const fs = Array.isArray(fields) ? fields : [];
  // `dirty` tracks fields the user has actually edited so streamed default
  // changes never clobber active input; everything else stays controlled by
  // the latest `fields` prop.
  const [dirty, setDirty] = React.useState<Record<string, true>>({});
  const [values, setValues] = React.useState<Record<string, unknown>>(() => reconcileValues({}, fs, {}));

  // Re-sync local state during render whenever the streamed `fields` change
  // shape or defaults (the recommended alternative to a clobbering effect:
  // https://react.dev/learn/you-might-not-need-an-effect). Guarded by a
  // content signature so a same-shape re-render does not loop.
  const signature = fieldsSignature(fs);
  const [prevSignature, setPrevSignature] = React.useState(signature);
  if (signature !== prevSignature) {
    setPrevSignature(signature);
    setValues(prev => reconcileValues(prev, fs, dirty));
    setDirty(prev => {
      // Drop dirty flags for fields that disappeared so a later re-add starts
      // from its default again instead of resurrecting a stale edit.
      const present = new Set(fs.map(f => f.name));
      let changed = false;
      const next: Record<string, true> = {};
      for (const name of Object.keys(prev)) {
        if (present.has(name)) next[name] = true;
        else changed = true;
      }
      return changed ? next : prev;
    });
  }

  function setField(name: string, value: unknown) {
    setValues(v => ({ ...v, [name]: value }));
    setDirty(d => (d[name] ? d : { ...d, [name]: true }));
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
