import { createHash } from 'node:crypto';

const body = Buffer.from('controlled concurrency bytes');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const latch = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

async function fixtureSession(api, fixtures, ids) {
  const events = [], admitted = [], rows = [], jobs = [], closures = [];
  const responses = new Map(), socketIds = new Map(), automatic = new Set();
  const arrivals = new Map(ids.map(id => [id, latch()]));
  const peerCloses = new Map(ids.map(id => [id, latch()]));
  const hosts = new Map(ids.map(id => [`${id}.fixture.example.test`, id]));
  let connections = 0, socketCloses = 0, responseCloses = 0, active = 0, peak = 0, open = false;
  const emit = (id, event) => events.push({ id, event });
  const release = id => {
    const response = responses.get(id);
    if (response && !response.destroyed && !response.writableEnded) {
      emit(id, 'release');
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end(body);
    }
  };
  const fixture = await fixtures.startFixture((request, response) => {
    const id = request.url.slice(1);
    socketIds.set(request.socket, id);
    responses.set(id, response);
    active++; peak = Math.max(peak, active);
    emit(id, 'http');
    let ended = false;
    const endActive = () => { if (!ended) { active--; ended = true; } };
    response.once('finish', () => { endActive(); emit(id, 'response-finish'); });
    response.once('close', () => { endActive(); responseCloses++; emit(id, 'response-close'); });
    arrivals.get(id).resolve();
    if (open || automatic.has(id)) release(id);
  });
  fixture.server.on('connection', socket => {
    connections++;
    const closed = latch();
    closures.push(closed.promise);
    socket.once('close', () => {
      socketCloses++;
      const id = socketIds.get(socket) ?? 'unidentified';
      emit(id, 'socket-close');
      peerCloses.get(id)?.resolve();
      closed.resolve();
    });
  });
  const seam = fixtures.localTestSeam({ port: fixture.port, hostnames: [...hosts.keys()],
    resolveOverride(hostname) {
      const id = hosts.get(hostname);
      admitted.push(id); emit(id, 'admit');
      return Object.freeze({ addresses: Object.freeze(['127.0.0.1']), aliases: Object.freeze([]) });
    },
  });
  const fetcher = new api.SafeFetcher(seam);
  return {
    admitted, events, responses, emit, release,
    auto: id => automatic.add(id),
    waitHttp: ids => Promise.all(ids.map(id => arrivals.get(id).promise)),
    waitPeerClose: id => peerCloses.get(id).promise,
    held: ids => ids.every(id => responses.has(id) && !responses.get(id).headersSent),
    open() { open = true; for (const id of responses.keys()) release(id); },
    launch(id, controller) {
      emit(id, controller ? (controller.signal.aborted ? 'invoke-aborted' : 'invoke-live') : 'invoke');
      const promise = fetcher.fetch(fixtures.fixtureUrl(fixture.port, `/${id}`, `${id}.fixture.example.test`),
        controller ? { signal: controller.signal } : {}).then(result => {
          const row = { id, code: 'accepted', returned_bytes: result.bytes.byteLength, returned_sha256: hash(result.bytes) };
          rows.push(row); emit(id, 'result'); return row;
        }, error => {
          if (!(error instanceof api.RetrievalError)) throw error;
          const row = { id, code: error.code, returned_bytes: null, returned_sha256: null };
          rows.push(row); emit(id, 'result'); return row;
        });
      jobs.push(promise);
      return promise;
    },
    abort(id, controller) { emit(id, 'abort'); controller.abort(); },
    async finish() {
      await Promise.all(jobs);
      await Promise.all(closures);
      return { rows, events, admissions: admitted, connections, requests: responses.size,
        response_closes: responseCloses, socket_closes: socketCloses, peak_http: peak,
        active_http: active };
    },
    close: () => fixture.close(),
  };
}

const known = row => row.code === 'accepted' && row.returned_bytes === body.length && row.returned_sha256 === hash(body);
const closed = capture => capture.active_http === 0 && capture.connections === capture.requests
  && capture.socket_closes === capture.connections && capture.response_closes === capture.requests;

async function concurrency(api, fixtures) {
  const ids = Array.from({ length: 8 }, (_, index) => `parallel-${index}`);
  const session = await fixtureSession(api, fixtures, ids);
  try {
    for (const id of ids) session.launch(id);
    await Promise.resolve();
    const admissionSnapshot = [...session.admitted];
    session.emit('parallel', 'checkpoint');
    await session.waitHttp(admissionSnapshot);
    const held = admissionSnapshot.length > 0 && session.held(admissionSnapshot);
    session.emit('parallel', 'first-wave-http');
    session.open();
    const capture = await session.finish();
    return { ...capture, admission_snapshot: admissionSnapshot, headers_withheld: held,
      passed: admissionSnapshot.length === api.DEFAULT_RUN_LIMITS.concurrentFetches && held
        && capture.peak_http === api.DEFAULT_RUN_LIMITS.concurrentFetches && closed(capture)
        && capture.rows.length === 8 && capture.rows.every(known) };
  } finally { await session.close(); }
}

async function queuedCancellation(api, fixtures) {
  const holds = Array.from({ length: 4 }, (_, index) => `hold-${index}`);
  const session = await fixtureSession(api, fixtures, [...holds, 'queued', 'survivor']);
  try {
    for (const id of holds) session.launch(id);
    await Promise.resolve();
    const initial = [...session.admitted];
    await session.waitHttp(initial);
    if (initial.length !== 4) {
      session.open();
      return { ...await session.finish(), stage_reached: false, headers_withheld: false,
        queued_admitted: false, passed: false };
    }
    const controller = new AbortController();
    const pending = session.launch('queued', controller);
    await Promise.resolve();
    session.emit('queued', 'checkpoint');
    const headersWithheld = session.held(holds);
    const queuedAdmitted = session.admitted.includes('queued');
    if (queuedAdmitted) await session.waitHttp(['queued']);
    session.abort('queued', controller);
    const canceled = await pending;
    session.emit('queued', 'settled-before-release');
    if (queuedAdmitted) await session.waitPeerClose('queued');
    session.auto('survivor');
    const survivor = session.launch('survivor');
    session.release(holds[0]);
    await survivor;
    session.open();
    const capture = await session.finish();
    return { ...capture, stage_reached: true, headers_withheld: headersWithheld, queued_admitted: queuedAdmitted,
      passed: headersWithheld && !queuedAdmitted && canceled.code === 'CANCELED' && closed(capture)
        && capture.requests === 5 && capture.peak_http === 4 && capture.rows.length === 6
        && capture.rows.filter(row => row.id !== 'queued').every(known) };
  } finally { await session.close(); }
}

async function activeCancellation(api, fixtures) {
  const session = await fixtureSession(api, fixtures, ['active', 'followup']);
  try {
    const controller = new AbortController();
    const pending = session.launch('active', controller);
    await Promise.resolve();
    if (session.admitted.length !== 1) {
      session.open();
      return { ...await session.finish(), stage_reached: false, headers_withheld: false, passed: false };
    }
    await session.waitHttp(['active']);
    const headersWithheld = session.held(['active']);
    session.abort('active', controller);
    const canceled = await pending;
    await session.waitPeerClose('active');
    session.auto('followup');
    const followup = await session.launch('followup');
    const capture = await session.finish();
    return { ...capture, stage_reached: true, headers_withheld: headersWithheld,
      passed: headersWithheld && canceled.code === 'CANCELED' && known(followup)
        && capture.requests === 2 && capture.peak_http === 1 && closed(capture) };
  } finally { await session.close(); }
}

export async function probeConcurrency(api, fixtures) {
  const parallel = await concurrency(api, fixtures);
  const queued = await queuedCancellation(api, fixtures);
  const active = await activeCancellation(api, fixtures);
  return { fixture_mode: 'source-only-localTestSeam', concurrent_fetches: api.DEFAULT_RUN_LIMITS.concurrentFetches,
    parallel, queued, active, passed: parallel.passed && queued.passed && active.passed,
    capture_scope: 'Resolver admission checkpoint depends on pinned synchronous acquire and one Promise microtask; no public queue telemetry. peak_http counts fixture responses until finish/close, sockets counted separately. Native cancellation covers queue and active HTTP awaiting headers only; natural closure before cleanup. No external egress capture.',
  };
}
