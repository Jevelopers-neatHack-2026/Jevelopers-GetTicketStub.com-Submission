import { spawnSync } from "node:child_process";
import net from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const suiteFile = fileURLToPath(new URL("../tests/status-suite.mjs", import.meta.url));
export const STATUS_SUITE_CASE_COUNT = 30;

function credentialFreeEnvironment() {
  const environment = {};
  for (const key of ["PATH", "TMPDIR", "TMP", "TEMP"]) {
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  }
  return environment;
}

export function parseStatusOutput(stdout) {
  if (typeof stdout !== "string" || !stdout.endsWith("\n") || stdout.includes("\r")) {
    return { results: [], valid: false, unrecognizedCount: stdout === "" ? 0 : 1 };
  }
  const lines = stdout.slice(0, -1).split("\n");
  const results = [];
  const names = new Set();
  let summary = null;
  let unrecognizedCount = 0;
  for (const [index, line] of lines.entries()) {
    if (line.length === 0 || line !== line.trim()) {
      unrecognizedCount += 1;
      continue;
    }
    const resultMatch = /^(PASSED|FAILED) (.+)$/u.exec(line);
    if (resultMatch !== null && summary === null) {
      const status = resultMatch[1].toLowerCase();
      const payload = resultMatch[2];
      const separator = status === "failed" ? payload.indexOf(": ") : -1;
      const name = separator < 0 ? payload : payload.slice(0, separator);
      if (name.length === 0 || name.length > 240 || names.has(name) ||
        status === "failed" && (separator < 0 || payload.slice(separator + 2).length === 0)) {
        unrecognizedCount += 1;
        continue;
      }
      names.add(name);
      results.push({
        name,
        status,
        ...(separator < 0 ? {} : { detail: payload.slice(separator + 2) })
      });
      continue;
    }
    const summaryMatch = /^Status inbox suite: (\d+)\/(\d+) passed$/u.exec(line);
    if (summaryMatch !== null && index === lines.length - 1 && summary === null) {
      summary = { passed: Number(summaryMatch[1]), total: Number(summaryMatch[2]) };
      continue;
    }
    unrecognizedCount += 1;
  }
  const observedPassed = results.filter((result) => result.status === "passed").length;
  const valid = summary !== null && unrecognizedCount === 0 && results.length === STATUS_SUITE_CASE_COUNT &&
    summary.total === STATUS_SUITE_CASE_COUNT && summary.total === results.length &&
    summary.passed === observedPassed && summary.total - summary.passed === results.length - observedPassed;
  return { results, valid, unrecognizedCount };
}

export function runStatusTests({ spawn = spawnSync } = {}) {
  let child;
  let thrownError;
  try {
    child = spawn(process.execPath, [suiteFile], {
      cwd: repositoryRoot,
      encoding: "utf8",
      timeout: 300_000,
      maxBuffer: 10 * 1024 * 1024,
      env: credentialFreeEnvironment()
    });
  } catch (error) {
    thrownError = error;
    child = { stdout: "", stderr: "", status: null, signal: null,
      error: { code: error !== null && typeof error === "object" && "code" in error ? error.code : "spawn_failed" } };
  }
  if (child === null || typeof child !== "object") {
    child = { stdout: undefined, stderr: undefined, status: null, signal: null, error: { code: "invalid_spawn_result" } };
  }
  const parsed = parseStatusOutput(child.stdout);
  let results = parsed.results;
  if (!parsed.valid) {
    results = [...results, {
      name: "status suite process",
      status: "failed",
      detail: child.error?.code ?? `invalid_suite_output_${parsed.unrecognizedCount}`
    }];
  }
  const processError = child.error?.code ?? null;
  if (child.error !== undefined || child.status !== 0 || child.signal !== null && child.signal !== undefined) {
    if (results.every((result) => result.status === "passed")) {
      results = [...results, {
        name: "status suite process exit",
        status: "failed",
        detail: processError ?? (child.signal !== null && child.signal !== undefined
          ? `signal_${child.signal}` : `exit_${child.status ?? "unknown"}`)
      }];
    }
  }
  const stderrPresent = typeof child.stderr !== "string" || child.stderr.length > 0;
  if (stderrPresent && results.every((result) => result.name !== "status suite stderr")) {
    results = [...results, {
      name: "status suite stderr",
      status: "failed",
      detail: typeof child.stderr === "string" ? "stderr_present" : "invalid_stderr_output"
    }];
  }
  const passed = results.filter((result) => result.status === "passed").length;
  const failed = results.length - passed;
  return {
    schemaVersion: "fulfillment-status-suite-result/1",
    suite: "status",
    mode: "simulated",
    status: failed === 0 && thrownError === undefined && child.error === undefined && child.status === 0 &&
      (child.signal === null || child.signal === undefined) && !stderrPresent ? "passed" : "failed",
    passed,
    failed,
    results,
    processExitCode: child.status ?? null,
    processSignal: child.signal ?? null,
    processError,
    stderrPresent,
    externalProviderCalls: 0,
    orderCalls: 0,
    financeCalls: 0,
    skipped: 0
  };
}

async function runNetworkProbe(kind) {
  if (kind === "positive") {
    let server;
    try {
      server = net.createServer((socket) => socket.end("status-loopback-ok"));
      await new Promise((resolvePromise, rejectPromise) => {
        server.once("error", rejectPromise);
        server.listen(0, "127.0.0.1", resolvePromise);
      });
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("invalid_loopback_address");
      const received = await new Promise((resolvePromise, rejectPromise) => {
        const socket = net.createConnection(address.port, "127.0.0.1");
        let data = "";
        socket.setEncoding("utf8");
        socket.on("data", (chunk) => { data += chunk; });
        socket.once("error", rejectPromise);
        socket.once("end", () => resolvePromise(data));
      });
      const passed = received === "status-loopback-ok";
      return { schemaVersion: "fulfillment-network-probe/1", probe: kind, status: passed ? "passed" : "failed", received };
    } catch (error) {
      return { schemaVersion: "fulfillment-network-probe/1", probe: kind, status: "failed",
        errorCode: error !== null && typeof error === "object" && "code" in error ? error.code : "loopback_error" };
    } finally {
      if (server?.listening) await new Promise((resolvePromise) => server.close(resolvePromise));
    }
  }
  if (kind === "denied") {
    const server = net.createServer();
    const result = await new Promise((resolvePromise) => {
      const finish = (status, errorCode = null) => resolvePromise({
        schemaVersion: "fulfillment-network-probe/1",
        probe: kind,
        status,
        errorCode
      });
      server.once("error", (error) => finish(error?.code === "EPERM" ? "passed" : "failed", error?.code ?? null));
      try {
        server.listen(0, "127.0.0.1", () => finish("failed", "network_not_denied"));
      } catch (error) {
        finish(error?.code === "EPERM" ? "passed" : "failed", error?.code ?? null);
      }
    });
    if (server.listening) await new Promise((resolvePromise) => server.close(resolvePromise));
    return result;
  }
  return { schemaVersion: "fulfillment-network-probe/1", probe: kind, status: "failed", errorCode: "invalid_probe" };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let report;
  if (args.length === 0 || args.length === 4 && args[0] === "--suite" && args[1] === "status" && args[2] === "--mode" && args[3] === "simulated") {
    report = runStatusTests();
  } else if (args.length === 2 && args[0] === "--network-probe") {
    report = await runNetworkProbe(args[1]);
  } else {
    report = {
      schemaVersion: "fulfillment-status-suite-result/1",
      suite: "status",
      mode: "simulated",
      status: "failed",
      passed: 0,
      failed: 1,
      results: [{ name: "status suite arguments", status: "failed", detail: "invalid_arguments" }],
      processExitCode: null,
      processSignal: null,
      processError: null,
      stderrPresent: false,
      externalProviderCalls: 0,
      orderCalls: 0,
      financeCalls: 0,
      skipped: 0
    };
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.status !== "passed") process.exitCode = 1;
}
