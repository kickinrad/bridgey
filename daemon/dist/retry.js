const DEFAULT_OPTIONS = {
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30_000,
};
export async function withRetry(fn, options = {}) {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    let lastError;
    for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
        try {
            return await fn();
        }
        catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            if (opts.isRetryable && !opts.isRetryable(lastError)) {
                throw lastError;
            }
            if (attempt < opts.maxAttempts - 1) {
                const delay = Math.min(opts.baseDelayMs * Math.pow(2, attempt) + Math.random() * opts.baseDelayMs, opts.maxDelayMs ?? 30_000);
                await new Promise((r) => setTimeout(r, delay));
            }
        }
    }
    throw lastError;
}
