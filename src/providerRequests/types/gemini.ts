import type { ProviderMappingOptions, ProviderToolsOption, StripUnsupportedAttachmentOption } from './common';

export interface GeminiGenerateContentBodyOptions<TMeta = Record<string, unknown>> extends ProviderMappingOptions<TMeta> {
  /** Chorus tool definitions; serialized into Gemini `tools` (wrapped in `functionDeclarations`). Falls through unchanged if a raw Gemini tool array is detected. */
  tools?: ProviderToolsOption<TMeta>;
  [key: string]: unknown;
}

export interface GeminiTextPart {
  text: string;
}

export interface GeminiInlineDataPart {
  inlineData: { mimeType: string; data: string };
}

export interface GeminiFileDataPart {
  fileData: { mimeType: string; fileUri: string };
}

export interface GeminiFunctionCallPart {
  functionCall: { name: string; args: Record<string, unknown> };
}

export interface GeminiFunctionResponsePart {
  functionResponse: { name: string; response: Record<string, unknown> };
}

export type GeminiPart =
  | GeminiTextPart
  | GeminiInlineDataPart
  | GeminiFileDataPart
  | GeminiFunctionCallPart
  | GeminiFunctionResponsePart;

export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export type GeminiGenerateContentBody<TOptions = object> = StripUnsupportedAttachmentOption<TOptions> & {
  contents: GeminiContent[];
  systemInstruction?: { parts: Array<{ text: string }> };
};
