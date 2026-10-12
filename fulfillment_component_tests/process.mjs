import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';

export function runBounded(command, args, options = {}) {
  const { cwd, env, timeout = 180000, limit = 4 * 1024 * 1024, grace = 500 } = options;
  return new Promise(resolve => {
    const started = Date.now();
    const child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let bytes = 0; let failure = null; let escalation; let deadline; let finished = false;
    const signal = name => {
      if (!child.pid) return;
      try { process.kill(-child.pid, name); } catch (error) { if (error.code !== 'ESRCH') failure = 'termination_failed'; }
    };
    const stop = reason => {
      if (failure) return;
      failure = reason; signal('SIGTERM');
      escalation = setTimeout(() => signal('SIGKILL'), grace);
      deadline = setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); finish(null, 'unconfirmed'); }, grace + 3000);
    };
    const timer = setTimeout(() => stop('timeout'), timeout);
    function finish(exitCode, exitSignal) {
      if (finished) return;
      finished = true; clearTimeout(timer); clearTimeout(escalation); clearTimeout(deadline); signal('SIGKILL');
      let groupAbsent = !child.pid;
      if (child.pid) try { process.kill(-child.pid, 0); } catch (error) { groupAbsent = error.code === 'ESRCH'; }
      resolve({ exitCode, exitSignal, failure, groupAbsent, stdout, stderr, bytes, duration_ms: Date.now() - started });
    }
    for (const [stream, kind] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) {
      stream.setEncoding('utf8'); stream.on('data', chunk => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > limit) { stop('output_overflow'); return; }
        if (kind === 'stdout') stdout += chunk; else stderr += chunk;
      });
    }
    child.on('error', () => { failure = 'spawn_failed'; finish(null, null); });
    child.on('close', finish);
  });
}
export async function retirePrivate(root, confirmed) {
  if (!confirmed) return { confirmed: false, private_removed: false, quarantine: 'private-run-root' };
  await rm(root, { recursive: true });
  return { confirmed: true, private_removed: true };
}
