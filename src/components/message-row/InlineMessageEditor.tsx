import React from 'react';
import { Check, X } from 'lucide-react';
import { DEFAULT_MESSAGE_ACTION_LABELS } from '../../labels/messageActions';
import type { ChorusMessageActionLabels } from '../../labels/types';
import { useTextareaAutosize } from '../chat-input/useTextareaAutosize';

/**
 * Max auto-grow height (px) for the inline message editor textarea. Larger than
 * the composer's cap (`MAX_COMPOSER_TEXTAREA_HEIGHT`) because editing an
 * existing multi-paragraph message needs more room than drafting a new one, and
 * the editor sits in the roomier transcript rather than the bottom input bar.
 */
const MAX_EDIT_TEXTAREA_HEIGHT = 320;

export interface InlineMessageEditorProps {
  /**
   * Seeds the editable draft. The draft is *re-synced* to this value whenever it
   * changes while the editor is open: if the host rewrites the underlying
   * `message.text` beneath an open editor — an optimistic correction, a
   * regenerate that rewrites the message, a persistence/cross-tab sync — the
   * draft resets to the new text so a save can no longer overwrite the newer
   * text with a stale value. Any unsaved local edits are discarded by that
   * re-sync; the editor always reflects the current message text as its base.
   */
  initialText: string;
  onSubmit: (newText: string) => void;
  onCancel: () => void;
  labels?: ChorusMessageActionLabels;
}

export function InlineMessageEditor({ initialText, onSubmit, onCancel, labels = DEFAULT_MESSAGE_ACTION_LABELS }: InlineMessageEditorProps) {
  const [editText, setEditText] = React.useState(initialText);
  // Track the value the draft was last seeded from so we can detect when the
  // host rewrites `message.text` underneath an open editor. Adjusting state
  // during render (rather than in an effect) re-syncs synchronously, so the
  // textarea never paints the stale draft for a frame. See `initialText` above.
  const [seededText, setSeededText] = React.useState(initialText);
  if (initialText !== seededText) {
    setSeededText(initialText);
    setEditText(initialText);
  }
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  // Auto-grow to fit the content, matching the composer textarea — the hook
  // sizes the editor to `initialText` on mount and re-measures on every edit.
  useTextareaAutosize(textareaRef, editText, MAX_EDIT_TEXTAREA_HEIGHT);

  React.useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    el.focus();
    el.selectionStart = el.value.length;
  }, []);

  // Single source of truth for edit trimming: every default edit path (MessageRow
  // and MessageActionControls) routes its save through here, so callers receive a
  // non-empty trimmed string and an all-whitespace edit cancels instead of saving.
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
          // Ignore Enter while an IME candidate is being composed (e.g. Japanese/
          // Chinese/Korean input) so confirming a candidate does not submit the
          // half-composed text. keyCode 229 covers browsers that omit isComposing.
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
            e.preventDefault();
            submitEdit();
          }
          // Stop Escape from bubbling so cancelling an inline edit inside a
          // modal/dialog/drawer does not also close the surrounding ancestor.
          if (e.key === 'Escape') {
            e.stopPropagation();
            onCancel();
          }
        }}
      />
      <div className="chorus-edit-actions">
        <button type="button" className="chorus-action-btn" onClick={submitEdit} title={labels.save} aria-label={labels.save}><Check size={14} /></button>
        <button type="button" className="chorus-action-btn" onClick={onCancel} title={labels.cancel} aria-label={labels.cancel}><X size={14} /></button>
      </div>
    </div>
  );
}
