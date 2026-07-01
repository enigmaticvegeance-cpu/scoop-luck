/**
 * Standardized error shape thrown by server actions.
 *
 * The client receives only the message — never the cause or stack trace.
 * Sentry gets the full cause. This keeps the prompt's "no stack traces
 * in API responses" rule intact.
 */
export class FormError extends Error {
  readonly field?: string;

  constructor(message: string, field?: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "FormError";
    this.field = field;
  }
}

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; field?: string };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail(error: string, field?: string): ActionResult<never> {
  return { ok: false, error, field };
}