import { ChorusArtifactContext } from '../artifacts/artifactContext';
import { BlockProvider } from '../blocks/BlockContext';
import { ChatInput } from '../components/ChatInput';
import { ChatWindow } from '../components/ChatWindow';
import { ToolApprovalContext } from '../components/message-row/approvalContext';
import { ChorusArtifactPanel } from '../components/ChorusArtifactPanel';
import { joinClasses } from '../utils/className';
import { CostHeader } from './CostHeader';
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
  artifactPanel,
  blockRuntime,
  costView,
}: ChorusShellViewProps<TMeta>) {
  const withPanel = artifactPanel.open;
  const rootClass = joinClasses(rootProps.className, withPanel && 'chorus--with-artifact');
  const chatWindow = <ChatWindow<TMeta> {...transcriptProps} />;
  const transcript = approvalContextValue
    ? <ToolApprovalContext.Provider value={approvalContextValue}>{chatWindow}</ToolApprovalContext.Provider>
    : chatWindow;
  return (
    <ChorusArtifactContext.Provider value={artifactPanel.handle}>
      <BlockProvider blocks={blockRuntime.blocks} toolLoadingComponents={blockRuntime.toolLoadingComponents} emit={blockRuntime.emit} sending={blockRuntime.sending}>
        <div {...rootProps} className={rootClass} ref={rootRef}>
          <div className="chorus-shell-main">
            {costView && <CostHeader cost={costView.cost} budget={costView.budget} />}
            {transcript}
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
          {withPanel && (
            <ChorusArtifactPanel
              artifacts={artifactPanel.artifacts}
              activeId={artifactPanel.activeId}
              activeVersion={artifactPanel.activeVersion}
              onClose={artifactPanel.onClose}
              onChangeVersion={artifactPanel.onChangeVersion}
              codeTheme={artifactPanel.codeTheme}
              markdownSanitizer={artifactPanel.markdownSanitizer}
              renderReactArtifact={artifactPanel.renderReactArtifact}
            />
          )}
        </div>
      </BlockProvider>
    </ChorusArtifactContext.Provider>
  );
}
