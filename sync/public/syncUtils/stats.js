/** Per-run counters for sync / clear operations. */
export function createStats() {
  return { created: 0, updated: 0, unchanged: 0, archived: 0, skipped: 0, errors: 0 };
}

export function reportProgress(done, total, label, stats, onProgress, onStats) {
  if (onProgress) onProgress(done, total, label);
  if (onStats && (done % 10 === 0 || done === total)) onStats(stats);
}
