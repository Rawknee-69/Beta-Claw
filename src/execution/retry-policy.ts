/**
 * Retry policy with exponential backoff and jitter.
 *
 * Matches openclaw's documented behavior:
 *  - 3 attempts by default
 *  - 10% jitter
 *  - Per-channel minimum delays (discord: 500ms, telegram: 400ms, default: 200ms)
 *  - Max delay cap: 30 000ms
 *  - Only retries transient errors (rate-limits, timeouts, connection resets)
 */

export interface RetryConfig {
  /** Total number of attempts (including the first). Default: 3 */
  attempts: number;
  /** Minimum delay before the first retry in ms. Default varies by channel. */
  minDelayMs: number;
  /** Maximum delay cap in ms. Default: 30 000 */
  maxDelayMs: number;
  /** Jitter fraction applied to each delay (0.1 = ±10%). Default: 0.1 */
  jitter: number;
}

/** Channel-specific defaults matching openclaw's retry policy. */
export const CHANNEL_RETRY_DEFAULTS: Record<string, RetryConfig> = {
  discord:  { attempts: 3, minDelayMs: 500,  maxDelayMs: 30_000, jitter: 0.1 },
  telegram: { attempts: 3, minDelayMs: 400,  maxDelayMs: 30_000, jitter: 0.1 },
  default:  { attempts: 3, minDelayMs: 200,  maxDelayMs: 30_000, jitter: 0.1 },
};

export function getRetryConfig(channelId: string): RetryConfig {
  return CHANNEL_RETRY_DEFAULTS[channelId] ?? CHANNEL_RETRY_DEFAULTS['default']!;
}

/**
 * Calculate the delay for a given attempt number.
 *
 * Formula: min(minDelay × 2^(attempt-1) × (1 ± jitter), maxDelay)
 */
function calcDelay(cfg: RetryConfig, attempt: number): number {
  const base = cfg.minDelayMs * Math.pow(2, attempt - 1);
  const jitterFactor = 1 + (Math.random() * 2 - 1) * cfg.jitter;
  return Math.min(base * jitterFactor, cfg.maxDelayMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Determine if an error is transient and worth retrying.
 * Non-transient errors (auth failures, bad payloads, etc.) are not retried.
 */
export function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  // HTTP 429 rate limit
  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests')) return true;
  // Network transient errors
  if (msg.includes('econnreset') || msg.includes('econnrefused') || msg.includes('etimedout')) return true;
  if (msg.includes('timeout') || msg.includes('socket hang up')) return true;
  if (msg.includes('temporarily unavailable') || msg.includes('service unavailable')) return true;
  if (msg.includes('network') || msg.includes('fetch failed')) return true;
  // WhatsApp/Baileys connection errors during reconnection
  if (msg.includes('connection closed') || msg.includes('connection reset')) return true;
  return false;
}

/**
 * Execute `fn` with automatic retry on transient errors.
 *
 * @param fn          The async operation to attempt.
 * @param config      Retry configuration.
 * @param isRetryable Optional override for retryability check (defaults to isTransientError).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
  isRetryable: (err: unknown) => boolean = isTransientError,
): Promise<T> {
  let lastErr: unknown;

  for (let attempt = 1; attempt <= config.attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;

      if (attempt === config.attempts || !isRetryable(err)) {
        throw err;
      }

      // Extract retry-after header value if present in error message
      const retryAfterMs = extractRetryAfter(err);
      const delay = retryAfterMs ?? calcDelay(config, attempt);
      await sleep(delay);
    }
  }

  throw lastErr;
}

/** Try to parse a `retry_after` value (seconds) from an error message. */
function extractRetryAfter(err: unknown): number | null {
  if (!(err instanceof Error)) return null;
  const match = err.message.match(/retry[_\s-]?after[:\s]+(\d+(\.\d+)?)/i);
  if (match?.[1]) {
    const secs = parseFloat(match[1]);
    return Math.min(secs * 1000, 30_000);
  }
  return null;
}
