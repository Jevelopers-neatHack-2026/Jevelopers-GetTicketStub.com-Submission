import { createCreativeVersionApiPorts } from "../../src/versions/api-ports.mjs";
import { CreativeVersionStore } from "../../src/versions/store.mjs";

const [databasePath, objectRoot, encoded] = process.argv.slice(2);
if (typeof databasePath !== "string" || typeof objectRoot !== "string" || typeof encoded !== "string") {
  process.stderr.write("composition publication worker requires durable store and publication inputs\n");
  process.exit(87);
}

let input;
try { input = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); }
catch {
  process.stderr.write("composition publication worker received invalid JSON\n");
  process.exit(87);
}
const store = new CreativeVersionStore({ databasePath, objectRoot,
  now: () => Date.parse("2026-10-11T12:30:00.000Z") });
const faultPoint = input.fault_point ?? "composition.after_current_update";
try {
  const ports = createCreativeVersionApiPorts({ store, faultInjector(point) {
    if (point === faultPoint) {
      process.stdout.write(`hard_exit_at_${faultPoint}\n`);
      process.exit(86);
    }
  } });
  const result = await ports.jobs.completeIfActive({ scope: input.scope, actor_id: input.actor_id,
    job_id: input.job_id, lease_token: input.lease_token, action_id: input.action_id,
    operation: input.operation ?? "composition.create", result: input.result, publication_fence: input.publication_fence },
  (transaction) => ports.storage.commitCompositionRevision({ scope: input.scope,
    actor_id: input.actor_id, job_id: input.job_id, action_id: input.action_id,
    request_hash: input.request_hash, revision_sha256: input.revision_sha256 }, transaction));
  process.stderr.write(`expected injected hard exit, publication returned ${result?.status}\n`);
  process.exit(88);
} catch (error) {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exit(89);
}
