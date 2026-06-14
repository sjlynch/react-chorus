export type TabId =
  | 'streaming-basics'
  | 'tool-agent'
  | 'multi-provider'
  | 'multi-model'
  | 'artifacts'
  | 'generative-ui'
  | 'roleplay'
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
