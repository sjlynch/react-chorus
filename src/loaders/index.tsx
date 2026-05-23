/**
 * `react-chorus/loaders` — built-in tool-loader presets paired with the
 * `toolLoadingComponents` prop. Tree-shakeable so a consumer that imports
 * only `SkeletonTable` does not pay for `MapPing` / `CodeShimmer`.
 */
import type { ToolLoaderProps } from '../blocks/types';

export { DefaultToolLoader } from '../blocks/ToolLoader';

/** Generic spinner loader for any "thinking" tool. */
export function SpinnerLoader({ toolName }: ToolLoaderProps) {
  return (
    <div className="chorus-tool-loader chorus-tool-loader--spinner">
      <span className="chorus-tool-loader-spinner" aria-hidden="true" />
      <span className="chorus-tool-loader-label">{toolName}</span>
    </div>
  );
}

/** Animated table skeleton — fits a `search_docs` / `list_rows` style tool. */
export function SkeletonTable({ toolName }: ToolLoaderProps) {
  return (
    <div className="chorus-tool-loader chorus-tool-loader--skeleton-table" aria-label={`${toolName} loading`}>
      <div className="chorus-tool-loader-skeleton-row" />
      <div className="chorus-tool-loader-skeleton-row" />
      <div className="chorus-tool-loader-skeleton-row" />
    </div>
  );
}

/** Animated map ping — fits a `geocode` / `directions` style tool. */
export function MapPing({ toolName }: ToolLoaderProps) {
  return (
    <div className="chorus-tool-loader chorus-tool-loader--map-ping" aria-label={`${toolName} loading`}>
      <span className="chorus-tool-loader-ping" />
    </div>
  );
}

/** Animated code shimmer — fits a `run_code` / `generate_code` style tool. */
export function CodeShimmer({ toolName }: ToolLoaderProps) {
  return (
    <div className="chorus-tool-loader chorus-tool-loader--code-shimmer" aria-label={`${toolName} loading`}>
      <pre className="chorus-tool-loader-code-shimmer-pre">
        <span className="chorus-tool-loader-shimmer-line" />
        <span className="chorus-tool-loader-shimmer-line" />
        <span className="chorus-tool-loader-shimmer-line" />
      </pre>
    </div>
  );
}

export type { ToolLoaderProps } from '../blocks/types';
