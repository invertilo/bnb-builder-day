/**
 * Application-level quotas for the three public seller operations.
 *
 * A process-wide bucket is always enforced, including when the hosting
 * platform exposes no trustworthy caller identity. A second per-caller
 * bucket is enabled only when the operator names a header that its trusted
 * edge sets after stripping caller-supplied values. Request payload fields
 * and forwarded IP headers are deliberately never treated as identities.
 * The defaults are process-local; multi-replica owners can inject async
 * shared limiters without making that infrastructure mandatory.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { RateLimitExceeded, SlidingWindowLimiter } from "@bnbagent/sdk/utils";
import type { NextFunction, Request, Response } from "express";

type CommerceOperation = "negotiate" | "notify_funded" | "sell";

const DEFAULT_GLOBAL_MAX = 120;
const DEFAULT_CALLER_MAX = 20;
const DEFAULT_WINDOW_SECONDS = 60;
const DEFAULT_MAX_CALLERS = 10_000;
const SHARED_LIMITER_TIMEOUT_MS = 5_000;

export interface CommerceRateLimiter {
  /** Consume one request; honor cancellation and reject denied requests. */
  check(key: string, signal?: AbortSignal): void | Promise<void>;
}

export interface CommerceRateLimiters {
  readonly global: CommerceRateLimiter;
  readonly caller: CommerceRateLimiter;
}

interface CachedLimiters extends CommerceRateLimiters {
  readonly configKey: string;
}

const callerContext = new AsyncLocalStorage<string | undefined>();
let cached: CachedLimiters | undefined;
let injected: CommerceRateLimiters | undefined;
let warnedProcessLocal = false;

/** Replace process-local counters with application-owned shared limiters. */
export function setCommerceRateLimiters(
  value: CommerceRateLimiters | null,
): void {
  injected = value ?? undefined;
}

function positiveEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || !/^\d+$/u.test(raw)) return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function limiters(): CommerceRateLimiters {
  if (injected) return injected;
  const environment = (
    process.env.ENV ||
    process.env.ENVIRONMENT ||
    process.env.NODE_ENV ||
    ""
  )
    .trim()
    .toLowerCase();
  if (
    !warnedProcessLocal &&
    !["dev", "development", "test"].includes(environment)
  ) {
    warnedProcessLocal = true;
    console.warn(
      "[seller-agent] this process is using process-local rate limits; " +
        "inject shared limiters or enforce equivalent limits at a trusted edge before scaling out.",
    );
  }
  const names = [
    "SELLER_RATE_LIMIT_GLOBAL_MAX_REQUESTS",
    "SELLER_RATE_LIMIT_CALLER_MAX_REQUESTS",
    "SELLER_RATE_LIMIT_WINDOW_SECONDS",
    "SELLER_RATE_LIMIT_MAX_CALLERS",
  ] as const;
  const configKey = names.map((name) => process.env[name] ?? "").join("\0");
  if (cached?.configKey === configKey) return cached;

  const windowSeconds = positiveEnv(
    "SELLER_RATE_LIMIT_WINDOW_SECONDS",
    DEFAULT_WINDOW_SECONDS,
  );
  cached = {
    configKey,
    global: new SlidingWindowLimiter(
      positiveEnv("SELLER_RATE_LIMIT_GLOBAL_MAX_REQUESTS", DEFAULT_GLOBAL_MAX),
      windowSeconds,
      3,
    ),
    caller: new SlidingWindowLimiter(
      positiveEnv("SELLER_RATE_LIMIT_CALLER_MAX_REQUESTS", DEFAULT_CALLER_MAX),
      windowSeconds,
      positiveEnv("SELLER_RATE_LIMIT_MAX_CALLERS", DEFAULT_MAX_CALLERS),
    ),
  };
  return cached;
}

async function checkLimiter(
  limiter: CommerceRateLimiter,
  key: string,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  try {
    await Promise.race([
      Promise.resolve(limiter.check(key, controller.signal)),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => {
            controller.abort();
            reject(new RateLimitExceeded("Seller rate limiter unavailable"));
          },
          SHARED_LIMITER_TIMEOUT_MS,
        );
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function trustedCaller(headers: Request["headers"]): string | undefined {
  const header = (process.env.SELLER_TRUSTED_CALLER_HEADER ?? "")
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9-]+$/u.test(header)) return undefined;

  const raw = headers[header];
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  if (value.length === 0 || value.length > 256 || /[\r\n]/u.test(value)) {
    return undefined;
  }
  return value;
}

/** Carry only an operator-configured, edge-authenticated identity. */
export function withTrustedCaller<T>(
  headers: Request["headers"],
  work: () => T,
): T {
  return callerContext.run(trustedCaller(headers), work);
}

/** Express middleware that makes the trusted identity available to handlers. */
export function requestLimitContext(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  withTrustedCaller(req.headers, next);
}

/** Consume both the mandatory process bucket and optional caller bucket. */
export async function limitCommerceOperation(
  operation: CommerceOperation,
): Promise<void> {
  const active = limiters();
  await checkLimiter(active.global, operation);
  const caller = callerContext.getStore();
  if (caller !== undefined) {
    await checkLimiter(active.caller, `${operation}:${caller}`);
  }
}

export function isCommerceRateLimitError(error: unknown): boolean {
  return error instanceof RateLimitExceeded;
}
