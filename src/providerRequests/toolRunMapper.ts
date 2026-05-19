import type { Message, ToolMessage } from '../types';
import { forEachHistoryEntry } from './toolRunIterator';

export type ToolRunPair<TMeta, TBlock> = { message: ToolMessage<TMeta>; block: TBlock };

export interface ToolRunMapperSpec<TMeta, TBlock, TTarget> {
  /** Map a non-tool message to a target item; null skips it. */
  mapMessage: (message: Message<TMeta>) => TTarget | null;
  /** Extract the provider-typed tool block from a tool message; null delegates to `fallback`. */
  extractToolBlock: (message: ToolMessage<TMeta>) => TBlock | null;
  /** Emit a group of (message, block) pairs into `target`. */
  emitToolGroup: (target: TTarget[], pairs: Array<ToolRunPair<TMeta, TBlock>>) => void;
  /** Map a tool message that `extractToolBlock` did not claim; null skips it. */
  fallback: (message: ToolMessage<TMeta>) => TTarget | null;
  /**
   * How to group typed tool messages within a single contiguous tool run:
   * - `all`: aggregate every typed message in the run into one `emitToolGroup` call, emitted
   *   before the fallbacks for that run. Matches Anthropic / OpenAI Chat Completions.
   * - `contiguous`: aggregate typed messages in contiguous sub-runs, interleaved with fallbacks
   *   in original order. Matches OpenAI Responses (sub-runs of size 1+) and Gemini.
   */
  groupMode: 'all' | 'contiguous';
}

/**
 * Walks `history` and produces a flat target array, applying `mapMessage` to non-tool messages
 * and routing each contiguous tool run through `extractToolBlock` + `emitToolGroup` / `fallback`.
 *
 * Centralises the partition/append/fallback walk that every provider request mapper performs.
 * Provider-specific shape lives entirely in the `spec` callbacks; the helper only owns the
 * iteration and grouping policy.
 */
export function mapHistoryWithToolRuns<TMeta, TBlock, TTarget>(
  history: Message<TMeta>[],
  spec: ToolRunMapperSpec<TMeta, TBlock, TTarget>,
): TTarget[] {
  const target: TTarget[] = [];

  forEachHistoryEntry(history, {
    onMessage: message => {
      const mapped = spec.mapMessage(message);
      if (mapped) target.push(mapped);
    },
    onToolRun: run => {
      if (spec.groupMode === 'all') {
        const pairs: Array<ToolRunPair<TMeta, TBlock>> = [];
        const fallbacks: ToolMessage<TMeta>[] = [];
        for (const message of run) {
          const block = spec.extractToolBlock(message);
          if (block) pairs.push({ message, block });
          else fallbacks.push(message);
        }
        if (pairs.length) spec.emitToolGroup(target, pairs);
        for (const message of fallbacks) {
          const mapped = spec.fallback(message);
          if (mapped) target.push(mapped);
        }
        return;
      }

      let pairs: Array<ToolRunPair<TMeta, TBlock>> = [];
      for (const message of run) {
        const block = spec.extractToolBlock(message);
        if (block) {
          pairs.push({ message, block });
          continue;
        }
        if (pairs.length) {
          spec.emitToolGroup(target, pairs);
          pairs = [];
        }
        const mapped = spec.fallback(message);
        if (mapped) target.push(mapped);
      }
      if (pairs.length) spec.emitToolGroup(target, pairs);
    },
  });

  return target;
}
