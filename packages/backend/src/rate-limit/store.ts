/**
 * Rate-Limit Redis Store
 *
 * Uses a Lua script for an atomic fixed-window counter:
 *   1. INCR the key.
 *   2. On the first call (count == 1) set PEXPIRE so the window starts now.
 *   3. Return [count, pttl_ms] so the middleware can set Retry-After accurately.
 *
 * Why Lua?  INCR + PEXPIRE must be atomic — a TOCTOU race between the two
 * calls would allow the window to never expire if the server crashes between
 * them.
 */

import { getRedisClient } from '../redis/client';
import { RateLimitResult } from './types';

// ---------------------------------------------------------------------------
// Lua script
// ---------------------------------------------------------------------------

/**
 * KEYS[1] = rate-limit key
 * ARGV[1] = window duration in milliseconds (string)
 *
 * Returns: [count (integer), pttl_ms (integer)]
 *   pttl_ms is -1 when the key has no TTL (shouldn't happen but handled below)
 */
const INCR_EXPIRE_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local pttl = redis.call('PTTL', KEYS[1])
return {count, pttl}
`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Atomically increment the request counter for `key` and return the current
 * count together with the time-to-reset.
 *
 * @param key      Full Redis key, e.g. `rl:u:user-123`
 * @param max      Limit threshold (used to derive `remaining`)
 * @param windowMs Window duration in milliseconds
 */
export async function increment(
  key: string,
  max: number,
  windowMs: number
): Promise<RateLimitResult> {
  const client = await getRedisClient();

  // redis `eval` returns unknown; cast to the shape our Lua script produces
  const raw = (await client.eval(INCR_EXPIRE_SCRIPT, {
    keys: [key],
    arguments: [String(windowMs)],
  })) as [number, number];

  const count = raw[0];
  const pttl = raw[1]; // ms until expiry (-1 = no TTL, -2 = key gone)
  const resetMs = pttl > 0 ? pttl : windowMs;
  const resetAt = Math.ceil((Date.now() + resetMs) / 1000); // Unix seconds

  return {
    count,
    remaining: Math.max(0, max - count),
    resetMs,
    resetAt,
    exceeded: count > max,
  };
}

/**
 * Delete a rate-limit key (useful in tests or admin tooling to reset a
 * specific user / tenant).
 */
export async function resetKey(key: string): Promise<void> {
  const client = await getRedisClient();
  await client.del(key);
}
