const TASK_EXECUTION_MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retryTaskExecution<T>(
  fn: () => Promise<T>,
  onRetry?: (attempt: number, error: unknown) => void
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < TASK_EXECUTION_MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < TASK_EXECUTION_MAX_RETRIES - 1) {
        const delayMs = 2000 * Math.pow(2, attempt);
        onRetry?.(attempt + 1, error);
        await sleep(delayMs);
      } else {
        throw error;
      }
    }
  }
  throw lastError;
}
