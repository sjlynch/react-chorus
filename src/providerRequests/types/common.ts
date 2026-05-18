import type { Attachment, Message } from '../../types';
import type { ChorusToolDefinition, ChorusToolRegistry } from '../../tools';

export type UnsupportedAttachmentText<TMeta = Record<string, unknown>> = (
  attachment: Attachment,
  message: Message<TMeta>,
) => string;

export interface ProviderMappingOptions<TMeta = Record<string, unknown>> {
  /** Override the text block inserted when an attachment cannot be represented in the provider schema. */
  unsupportedAttachmentText?: UnsupportedAttachmentText<TMeta>;
}

/** Convenience type for the `tools` body option: array of definitions or full Chorus tool registry. */
export type ProviderToolsOption<TMeta = Record<string, unknown>> =
  | ChorusToolDefinition<TMeta>[]
  | ChorusToolRegistry<TMeta>;

// Body return types use generics so caller-provided option fields survive into
// the returned object's type for SDK `satisfies` checks.
export type StripChorusOptions<T> = Omit<T, 'unsupportedAttachmentText' | 'stream'>;
export type StripUnsupportedAttachmentOption<T> = Omit<T, 'unsupportedAttachmentText'>;
