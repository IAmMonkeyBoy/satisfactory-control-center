/**
 * The message of whatever was thrown.
 *
 * `catch` binds `unknown`, and everything the ingestors catch ends up in a log
 * line or a watcher event rather than being rethrown, so one place to turn a
 * cause into readable text keeps that conversion from being rewritten per module.
 */
export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
