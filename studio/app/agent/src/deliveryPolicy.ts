/** Shared delivery ceilings for asynchronous A2A and synchronous MCP paths. */
export function envSeconds(name: string, dflt: number): number {
  const value = Number(process.env[name] || dflt);
  return Number.isFinite(value) && value > 0 ? value : dflt;
}

export const deliveryTimeoutSeconds = () =>
  envSeconds("NOTIFY_DELIVERY_TIMEOUT_SECONDS", 600);

/**
 * Smallest remaining submit window a funded job must still have before we
 * accept it. NOTIFY_DELIVERY_TIMEOUT_SECONDS is a ceiling, not a typical
 * duration, so it is capped by NOTIFY_MIN_SUBMIT_WINDOW_SECONDS (default 300s):
 * otherwise a long timeout would permanently reject every job whose buyer
 * chose a short but valid deadline (e.g. `--deadline-min 10`).
 */
export const minimumDeliveryWindowSeconds = () =>
  Math.min(
    deliveryTimeoutSeconds() + 60,
    envSeconds("NOTIFY_MIN_SUBMIT_WINDOW_SECONDS", 300),
  );

export class DeliveryTimeoutError extends Error {}

/** Bound an entire delivery attempt and abort cancellable work on timeout. */
export async function withTimeout<T>(
  work: Promise<T>,
  seconds: number,
  controller?: AbortController,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller?.abort();
      reject(new DeliveryTimeoutError(`timed out after ${seconds}s`));
    }, seconds * 1000);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
