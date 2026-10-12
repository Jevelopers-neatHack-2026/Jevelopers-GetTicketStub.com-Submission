/** Own partially constructed MOCK hosts until successful close and removal. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIntegratedHost } from '../../fixtures/controls/integrated-host.mjs';
export function createHostSessions({ createHost = createIntegratedHost,
  makeDirectory = () => mkdtempSync(join(tmpdir(), 'creative-integrated-browser-')),
  removeDirectory = dir => rmSync(dir, { recursive: true, force: true }) } = {}) {
  const pending = new Set();
  const dispose = value => { value.close?.(); removeDirectory(value.dir); pending.delete(value); };
  const cleanup = () => { for (const value of pending) dispose(value); };
  return {
    cleanup,
    async create(options = {}) {
      cleanup(); const dir = makeDirectory();
      try { return { dir, host: await createHost(dir, { enableComposition: true, ...options }) }; }
      catch (error) {
        const partial = { dir, close: error.fixtureCleanup }; pending.add(partial);
        // The constructor has already attempted close. Preserve a failed close
        // for the next reset/stop, without deleting that still-open directory.
        if (partial.close) throw error;
        try { dispose(partial); }
        catch (cleanup) { throw new AggregateError([error, cleanup], 'MOCK session initialization and cleanup failed'); }
        throw error;
      }
    },
  };
}
