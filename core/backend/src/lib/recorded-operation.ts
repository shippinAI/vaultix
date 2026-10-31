export type RecordedOperation = {
  signal: AbortSignal;
  remainingMs: () => number;
};

// Await the actual work. A timer only aborts its resources; it never substitutes
// a rejected race for completion of database or network operations.
export const runRecordedOperation = async <T>(
  timeoutMs: number,
  signal: AbortSignal | undefined,
  work: (operation: RecordedOperation) => Promise<T>
): Promise<T> => {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000)
    throw new Error("Recorded operation requires a deadline between 1 and 30000 milliseconds");
  const controller = new AbortController();
  const deadline = performance.now() + timeoutMs;
  const abort = () => controller.abort();
  const remainingMs = () => {
    const remaining = Math.floor(deadline - performance.now());
    if (controller.signal.aborted || remaining <= 0) throw new Error("Recorded operation stopped");
    return remaining;
  };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, timeoutMs);
  try {
    remainingMs();
    const result = await work({ signal: controller.signal, remainingMs });
    remainingMs();
    return result;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
};
