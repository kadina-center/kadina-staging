/**
 * Shared cursor-pagination helpers.
 *
 * Convention used across list endpoints: pagination only kicks in when the
 * caller passes `limit` (or `cursor`) explicitly, so existing callers that
 * expect a plain array response keep working unchanged.
 */

const DEFAULT_MAX_LIMIT = 200;

export function parseLimit(
  value: unknown,
  defaultLimit: number,
  maxLimit = DEFAULT_MAX_LIMIT
): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return defaultLimit;
  return Math.min(Math.floor(n), maxLimit);
}

export function parseCursor(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function isPaginationRequested(query: {
  cursor?: unknown;
  limit?: unknown;
}): boolean {
  return parseCursor(query.cursor) !== undefined || query.limit !== undefined;
}
