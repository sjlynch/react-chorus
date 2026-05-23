/**
 * `react-chorus/blocks` — built-in starter blocks plus the generative-UI
 * runtime types. Tree-shakeable: a consumer that imports only `CardBlock`
 * does not pay for `ChartBlock`. Heavier blocks (Chart) lazily load their
 * optional dependency at runtime.
 */
export { Card, CardBlock } from './Card';
export type { CardProps } from './Card';
export { Table, TableBlock } from './Table';
export type { TableProps } from './Table';
export { Form, FormBlock } from './Form';
export type { FormProps, FormField } from './Form';
export { Image, ImageBlock } from './Image';
export type { ImageProps } from './Image';
export { CodeBlockComponent, CodeBlockBlock } from './CodeBlock';
export type { CodeBlockProps } from './CodeBlock';
export { Diff, DiffBlock } from './Diff';
export type { DiffProps } from './Diff';
export { CalendarPicker, CalendarPickerBlock } from './CalendarPicker';
export type { CalendarPickerProps } from './CalendarPicker';
export { Chart, ChartBlock } from './Chart';
export type { ChartProps } from './Chart';
export type { BlockDefinition, BlockEmit, BlockEmitPayload, BlockRegistry, BlockRenderProps, BlockValidateResult, BlockValidator, ToolLoaderProps, ToolLoadingComponents } from './types';
export { BlockRenderer } from './BlockRenderer';
export type { BlockRendererProps } from './BlockRenderer';
export { parseStreamingJson } from './streamingJson';
export type { StreamingJsonResult } from './streamingJson';
