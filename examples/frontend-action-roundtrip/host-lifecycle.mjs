/** MOCK HTTP fixture ownership. Only reset/capture serialize; requests retain
 * their admitted host, and release/cancel may drain a retiring session. */
export function createHostLifecycle(initial, { create, finalize, remove }) {
  const session = value => ({ ...value, active: 0, closed: false, finalized: false, drainingOpen: true, waiters: [] });
  let current = session(initial), transition = null, queue = Promise.resolve();
  const pendingRemoval = new Set();
  const removeSession = value => { pendingRemoval.add(value); remove(value); pendingRemoval.delete(value); };
  const drain = value => value.active ? new Promise(resolve => value.waiters.push(resolve)) : Promise.resolve();
  return {
    state() { return { active: current.active, retiring: transition !== null, closed: current.closed, finalized: current.finalized, waiting: current.host.waiting ?? null }; },
    async acquire({ draining = false } = {}) {
      while (transition && !(draining && current.drainingOpen && !current.closed)) await transition;
      if (current.closed) throw new Error('Fixture host finalized; reset required');
      const value = current; value.active++;
      let released = false;
      return { host: value.host, release() {
        if (released) return; released = true;
        if (--value.active === 0) value.waiters.splice(0).forEach(resolve => resolve());
      } };
    },
    change(reason, options) {
      const result = queue.then(async () => {
        let finish; transition = new Promise(resolve => { finish = resolve; });
        let replacement, failure;
        try {
          for (const previous of pendingRemoval) removeSession(previous);
          // Build before closing the old host. Failed initialization leaves a
          // usable old session, and create owns cleanup of a partial host.
          if (options !== undefined) replacement = session(await create(options));
          // Recheck after each wake: a drain control can acquire a lease in
          // the microtask gap after the last lease releases its waiter.
          while (current.active) await drain(current);
          current.drainingOpen = false;
          if (!current.finalized) await finalize(current, reason);
          if (replacement) {
            const previous = current; current = replacement; replacement = null;
            removeSession(previous);
          }
        } catch (error) { failure = error; throw error; }
        finally {
          try {
            if (replacement) { try { replacement.host.close(); } finally { removeSession(replacement); } }
          } catch (error) {
            if (failure) throw new AggregateError([failure, error], 'Fixture transition and cleanup failed');
            throw error;
          } finally { current.drainingOpen = true; transition = null; finish(); }
        }
      });
      // Keep the lifecycle queue usable after failure; the caller still receives
      // the original rejection and the session's explicit closed/finalized state.
      queue = result.catch(() => {});
      return result;
    },
    async stop() { await this.change('orderly-server-stop'); removeSession(current); },
  };
}
