import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { createSqliteInspectionRepairController } from "../../src/inspection/index.mjs";

const [databasePath, actionId, delayArgument] = process.argv.slice(2);
const hash = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const database = new DatabaseSync(databasePath);
try {
  if (actionId === "hold-lock") {
    const delay = Number(delayArgument);
    if (!Number.isSafeInteger(delay) || delay < 1 || delay > 5_000) throw new Error("lock delay must be bounded");
    database.exec("BEGIN IMMEDIATE;");
    process.stdout.write("locked\n");
    await new Promise((resolve) => setTimeout(resolve, delay));
    database.exec("COMMIT;");
    process.stdout.write("released\n");
    process.exitCode = 0;
  } else {
  const controller = createSqliteInspectionRepairController({ database, now: () => 2_000 });
  const result = controller.recordRepairClaim({
    scope: { tenant_id: "tenant-1", project_id: "project-1", brief_id: "brief-1", design_version_id: "design-concurrent" },
    inspection_id: "inspection-concurrent",
    action_id: actionId,
    request_hash: hash(actionId),
    repair_action: "image.edit",
    simulated_units: 1.5,
  });
  process.stdout.write(JSON.stringify(result));
  }
} finally {
  database.close();
}
