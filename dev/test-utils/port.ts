/**
 * Poll a URL's /health endpoint until it responds with 2xx.
 * Rejects if the timeout is exceeded.
 */
export async function waitForHealth(
  baseUrl: string,
  timeoutMs = 5000,
  intervalMs = 100,
): Promise<void> {
  const healthUrl = `${baseUrl.replace(/\/$/, '')}/health`;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(healthUrl, {
        signal: AbortSignal.timeout(Math.min(1000, intervalMs)),
      });
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(`Health check at ${healthUrl} did not pass within ${timeoutMs}ms`);
}
