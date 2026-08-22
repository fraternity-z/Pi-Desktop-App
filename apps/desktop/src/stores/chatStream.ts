/**
 * Append one validated message.delta payload without ever replacing existing text.
 * Event-sequence deduplication happens before this function is called.
 */
export function appendMonotonicText(previous: string, delta: string): string {
  return delta.length === 0 ? previous : previous + delta;
}
