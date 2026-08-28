/**
 * Append one validated stream payload without ever shrinking or duplicating text.
 * Event-sequence deduplication happens before this function is called, but some
 * providers still send cumulative snapshots or overlapping chunks.
 */
export function appendMonotonicText(previous: string, delta: string): string {
  if (!delta || !previous) return previous ? previous + delta : delta;
  if (delta === previous || delta.startsWith(previous)) return delta;
  if (previous.endsWith(delta)) return previous;

  // Merge a short overlap while keeping ordinary one-character chunks append-only.
  const maxOverlap = Math.min(previous.length, delta.length - 1, 64);
  for (let overlap = maxOverlap; overlap >= 2; overlap -= 1) {
    if (previous.endsWith(delta.slice(0, overlap))) {
      return previous + delta.slice(overlap);
    }
  }
  return previous + delta;
}
