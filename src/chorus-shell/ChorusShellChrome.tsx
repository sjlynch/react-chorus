import { ChatInput } from '../components/ChatInput';
import { ChatWindow } from '../components/ChatWindow';
import { ToolApprovalContext } from '../components/message-row/approvalContext';
import type { ChorusMcpStatusView, ChorusShellViewProps } from './props';

function ChorusMcpStatus({ servers, reconnect }: ChorusMcpStatusView) {
  const visibleServers = servers.filter(server => server.status !== 'connected' && server.status !== 'idle');
  if (visibleServers.length === 0) return null;

  return (
    <div className="chorus-mcp-status" aria-live="polite">
      {visibleServers.map(server => (
        <div key={server.name} className="chorus-mcp-status-item" data-chorus-mcp-status={server.status}>
          <span className="chorus-mcp-status-text">
            MCP {server.name}: {server.status}
            {server.error ? ` — ${server.error}` : ''}
            {server.reconnectInMs ? ` (reconnecting in ${Math.ceil(server.reconnectInMs / 1000)}s)` : ''}
          </span>
          <button type="button" className="chorus-mcp-reconnect" onClick={() => reconnect(server.name)}>
            Reconnect
          </button>
        </div>
      ))}
    </div>
  );
}

export function ChorusShellChrome<TMeta = Record<string, unknown>>({
  rootRef,
  rootProps,
  transcriptProps,
  clearControl,
  mcpStatus,
  composer,
  approvalContextValue,
}: ChorusShellViewProps<TMeta>) {
  const window = <ChatWindow<TMeta> {...transcriptProps} />;
  return (
    <div {...rootProps} ref={rootRef}>
      {approvalContextValue
        ? <ToolApprovalContext.Provider value={approvalContextValue}>{window}</ToolApprovalContext.Provider>
        : window}
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
      {mcpStatus && <ChorusMcpStatus {...mcpStatus} />}
      <ChatInput ref={composer.ref} {...composer.props} />
    </div>
  );
}
