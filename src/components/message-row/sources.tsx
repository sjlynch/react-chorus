import type { MessageSource } from '../../types';
import { DEFAULT_SOURCE_LABELS } from '../../labels/sources';
import type { ChorusSourceLabels } from '../../labels/types';
import { sourceDisplayLabel } from '../../utils/sourceDisplayLabel';

export interface MessageSourcesProps {
  sources?: MessageSource[];
  labels?: ChorusSourceLabels;
}

export function MessageSources({ sources, labels = DEFAULT_SOURCE_LABELS }: MessageSourcesProps) {
  if (!sources || sources.length === 0) return null;

  return (
    <div className="chorus-sources" aria-label={labels.sources}>
      <div className="chorus-sources-title">{labels.sources}</div>
      <ol className="chorus-source-list">
        {sources.map((source, index) => {
          const fallback = labels.source(index);
          const label = sourceDisplayLabel(source, fallback);
          const key = source.id ?? source.url ?? `${label}-${index}`;
          return (
            <li key={key} className="chorus-source-item">
              {source.url ? (
                <a className="chorus-source-link" href={source.url} target="_blank" rel="noreferrer">{label}</a>
              ) : (
                <span className="chorus-source-label">{label}</span>
              )}
              {source.snippet && <span className="chorus-source-snippet">{source.snippet}</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
