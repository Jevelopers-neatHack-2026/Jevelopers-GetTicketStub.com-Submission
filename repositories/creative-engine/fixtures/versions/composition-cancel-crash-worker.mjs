import { createCreativeVersionApiPorts } from "../../src/versions/api-ports.mjs";
import { CreativeVersionStore } from "../../src/versions/store.mjs";

const [databasePath, objectRoot, tenant_id, project_id, brief_id, actor_id, job_id, action_id] = process.argv.slice(2);
if ([databasePath, objectRoot, tenant_id, project_id, brief_id, actor_id, job_id, action_id]
  .some((value) => typeof value !== "string" || value.length === 0)) {
  process.stderr.write("composition crash worker requires complete durable job identity\n");
  process.exit(87);
}

const store = new CreativeVersionStore({ databasePath, objectRoot, now: () => Date.parse("2026-10-11T12:30:00.000Z") });
try {
  const ports = createCreativeVersionApiPorts({ store });
  const cancelled = await ports.jobs.cancel({ scope: { tenant_id, project_id, brief_id }, actor_id, job_id,
    target_action_id: action_id, action_id: `cancel-${action_id}`, request_hash: `sha256:${"a".repeat(64)}` });
  if (cancelled.kind !== "cancelled") {
    process.stderr.write(`expected durable cancellation, received ${cancelled.kind}\n`);
    process.exit(88);
  }
  process.stdout.write("durable_cancel_committed\n");
  process.exit(86);
} catch (error) {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exit(89);
}
