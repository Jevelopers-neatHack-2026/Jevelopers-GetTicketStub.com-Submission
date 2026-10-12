import { CoverageFailure } from './coverage-types.js';

/** Monotonic local liveness fence. Expired callbacks cannot resume a protected continuation. */
export function coverageDeadline() {
  const expires = performance.now() + 15_000;
  let closed = false;
  const expired = () => new CoverageFailure('SOURCE_UNAVAILABLE', 'Coverage operation timed out before current authority could be confirmed.', true);
  const check = () => { if (closed || performance.now() >= expires) { closed = true; throw expired(); } };
  return {
    check,
    close: () => { closed = true; },
    async wait<T>(operation: () => Promise<T>, limitMs = 2_000): Promise<T> {
      check();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const deadline = new Promise<never>((_, reject) => {
          timer = setTimeout(() => { closed = true; reject(expired()); }, Math.min(limitMs, Math.max(1, expires - performance.now())));
        });
        const result = await Promise.race([operation(), deadline]);
        check();
        return result;
      } finally { if (timer !== undefined) clearTimeout(timer); }
    },
  };
}
