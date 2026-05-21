import { ChatInput } from '../components/ChatInput';
import { ChatWindow } from '../components/ChatWindow';
import type { ChorusShellViewProps } from './props';

export function ChorusShellChrome<TMeta = Record<string, unknown>>({
  rootRef,
  rootProps,
  transcriptProps,
  clearControl,
  composer,
}: ChorusShellViewProps<TMeta>) {
  return (
    <div {...rootProps} ref={rootRef}>
      <ChatWindow<TMeta> {...transcriptProps} />
      {clearControl.visible && (
        <div className="chorus-clear-row">
          <button
            type="button"
            className="chorus-clear-btn"
            onClick={clearControl.onClick}
            disabled={clearControl.disabled}
          >
            {clearControl.label}
          </button>
        </div>
      )}
      <ChatInput ref={composer.ref} {...composer.props} />
    </div>
  );
}
