/**
 * `react-chorus/validators` — one-line adapters that turn a validator
 * instance from a popular library into a `BlockValidator`. The adapters are
 * intentionally untyped against the specific validator package so the core
 * library does not peer-depend on any of them; the consumer brings the
 * runtime, the adapter wires it up.
 *
 * Each adapter returns `{ ok: true, props }` or `{ ok: false, errors }`,
 * matching the `BlockValidator` contract in `react-chorus/blocks`.
 */
import type { BlockValidator } from '../blocks/types';

/**
 * Adapter for a Zod schema instance. Pass a schema with a `safeParse`
 * method:
 *
 * ```ts
 * import { z } from 'zod';
 * import { zodAdapter } from 'react-chorus/validators';
 * const validate = zodAdapter(z.object({ city: z.string(), temp: z.number() }));
 * ```
 */
export function zodAdapter<T = unknown>(schema: { safeParse: (input: unknown) => { success: boolean; data?: T; error?: { issues?: Array<{ path?: (string | number)[]; message?: string }> } } }): BlockValidator<T> {
  return (input: unknown) => {
    const result = schema.safeParse(input);
    if (result.success && result.data !== undefined) return { ok: true, props: result.data };
    const errors = (result.error?.issues ?? []).map(issue => {
      const path = issue.path?.length ? issue.path.join('.') + ': ' : '';
      return path + (issue.message ?? 'invalid');
    });
    return { ok: false, errors: errors.length ? errors : ['validation failed'] };
  };
}

/**
 * Adapter for a Valibot schema instance. Pass a schema and the `safeParse`
 * function from Valibot:
 *
 * ```ts
 * import { object, string, safeParse } from 'valibot';
 * import { valibotAdapter } from 'react-chorus/validators';
 * const Schema = object({ city: string() });
 * const validate = valibotAdapter(safeParse, Schema);
 * ```
 */
export function valibotAdapter<T = unknown>(
  safeParse: (schema: unknown, input: unknown) => { success: boolean; output?: T; issues?: Array<{ message?: string; path?: Array<{ key?: string | number }> }> },
  schema: unknown,
): BlockValidator<T> {
  return (input: unknown) => {
    const result = safeParse(schema, input);
    if (result.success && result.output !== undefined) return { ok: true, props: result.output };
    const errors = (result.issues ?? []).map(issue => {
      const path = issue.path?.map(p => p.key).filter(k => k !== undefined).join('.') ?? '';
      return (path ? path + ': ' : '') + (issue.message ?? 'invalid');
    });
    return { ok: false, errors: errors.length ? errors : ['validation failed'] };
  };
}

/**
 * Adapter that validates against a JSON-Schema-style validator function the
 * caller pre-compiles (e.g. with Ajv). The validator is a function that
 * returns `true` on success and exposes an `errors` array on failure, which
 * matches the Ajv contract:
 *
 * ```ts
 * import Ajv from 'ajv';
 * import { jsonSchemaAdapter } from 'react-chorus/validators';
 * const ajv = new Ajv();
 * const check = ajv.compile({ type: 'object', required: ['city'] });
 * const validate = jsonSchemaAdapter(check);
 * ```
 */
export function jsonSchemaAdapter<T = unknown>(
  validator: ((input: unknown) => boolean) & { errors?: Array<{ instancePath?: string; message?: string }> | null },
): BlockValidator<T> {
  return (input: unknown) => {
    const ok = Boolean(validator(input));
    if (ok) return { ok: true, props: input as T };
    const errors = (validator.errors ?? []).map(err => {
      const path = err.instancePath ?? '';
      return (path ? path + ': ' : '') + (err.message ?? 'invalid');
    });
    return { ok: false, errors: errors.length ? errors : ['validation failed'] };
  };
}

export type { BlockValidator, BlockValidateResult } from '../blocks/types';
