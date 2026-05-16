import React from 'react';
import { Check, X } from 'lucide-react';

export interface InlineMessageEditorProps {
  initialText: string;
  onSubmit: (newText: string) => void;
  onCancel: () => void;
}

export function InlineMessageEditor({ initialText, onSubmit, onCancel }: InlineMessageEditorProps) {
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
        aria-label="Edit message"
        value={editText}
        onChange={e => setEditText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitEdit(); }
          if (e.key === 'Escape') onCancel();
        }}
      />
      <div className="chorus-edit-actions">
        <button type="button" className="chorus-action-btn" onClick={submitEdit} title="Save" aria-label="Save"><Check size={14} /></button>
        <button type="button" className="chorus-action-btn" onClick={onCancel} title="Cancel" aria-label="Cancel"><X size={14} /></button>
      </div>
    </div>
  );
}
