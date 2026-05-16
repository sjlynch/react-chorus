export type TabId =
  | 'streaming-basics'
  | 'tool-agent'
  | 'markdown'
  | 'attachments'
  | 'multi-conversation'
  | 'theming';

export interface PlaygroundTab {
  id: TabId;
  label: string;
  subtitle: string;
  render: () => React.ReactNode;
}
