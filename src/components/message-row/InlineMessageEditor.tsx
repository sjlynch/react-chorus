import React from 'react';
import { Check, X } from 'lucide-react';
import { DEFAULT_MESSAGE_ACTION_LABELS } from '../../labels/messageActions';
import type { ChorusMessageActionLabels } from '../../labels/types';

export interface InlineMessageEditorProps {
  initialText: string;
  onSubmit: (newText: string) => void;
  onCancel: () => void;
  labels?: ChorusMessageActionLabels;
}

export function InlineMessageEditor({ initialText, onSubmit, onCancel, labels = DEFAULT_MESSAGE_ACTION_LABELS }: InlineMessageEditorProps) {
  const [editText, setEditText] = React.useState(initialText);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    el.focus();
    el.selectionStart = el.value.length;
  }, []);

  const submitEdit = () => {
    const trimmed = editText.trim();
    if (trimmed) onSubmit(trimmed);
    else onCancel();
  };

  return (
    <div className="chorus-edit-wrap">
      <textarea
        ref={textareaRef}
        className="chorus-edit-textarea"
        aria-label={labels.editTextareaAriaLabel}
        value={editText}
        onChange={e => setEditText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitEdit(); }
          if (e.key === 'Escape') onCancel();
        }}
      />
      <div className="chorus-edit-actions">
        <button type="button" className="chorus-action-btn" onClick={submitEdit} title={labels.save} aria-label={labels.save}><Check size={14} /></button>
        <button type="button" className="chorus-action-btn" onClick={onCancel} title={labels.cancel} aria-label={labels.cancel}><X size={14} /></button>
      </div>
    </div>
  );
}
