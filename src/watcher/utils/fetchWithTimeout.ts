const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Wraps the native fetch with an AbortController-based timeout.
 * Throws a DOMException with name "AbortError" if the request exceeds timeoutMs.
 */
export async function fetchWithTimeout(
  url: string | URL,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
