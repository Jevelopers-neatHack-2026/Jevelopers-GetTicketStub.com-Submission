import { spawn } from 'node:child_process';

export function runBounded(command, args, options = {}) {
  const { cwd, env, timeout = 180000, limit = 2 * 1024 * 1024, grace = 1000, onLine, abortSignal } = options;
  return new Promise(resolve => {
    const start = Date.now();
    const child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let bytes = 0; let failure = null; let escalation; let deadline;
    const signal = name => {
      try { process.kill(-child.pid, name); } catch (error) { if (error.code !== 'ESRCH') failure = 'termination_failed'; }
    };
    const stop = reason => {
      if (failure) return;
      failure = reason; signal('SIGTERM');
      escalation = setTimeout(() => signal('SIGKILL'), grace);
      deadline = setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); finish(null, 'unconfirmed'); }, grace + 3000);
    };
    const abort = () => stop('observer_stopped');
    abortSignal?.addEventListener('abort', abort, { once: true });
    let finished = false;
    const timer = setTimeout(() => stop('timeout'), timeout);
    function finish(exitCode, exitSignal) {
      if (finished) return;
      finished = true; abortSignal?.removeEventListener('abort', abort); clearTimeout(timer); clearTimeout(escalation); clearTimeout(deadline);
      // A shell may exit before its descendants; kill the original group even after close.
      signal('SIGKILL');
      let groupAbsent = false;
      try { process.kill(-child.pid, 0); } catch (error) { groupAbsent = error.code === 'ESRCH'; }
      resolve({ exitCode, exitSignal, failure, groupAbsent, stdout, stderr, bytes, duration_ms: Date.now() - start });
    }
    for (const [stream, kind] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) {
      stream.setEncoding('utf8');
      stream.on('data', chunk => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > limit) { stop('output_overflow'); return; }
        if (kind === 'stdout') { stdout += chunk; if (onLine) onLine(chunk); } else stderr += chunk;
      });
    }
    child.on('error', () => { failure = 'spawn_failed'; finish(null, null); });
    child.on('close', finish);
  });
}
