import { validateArtifact } from '../artifact.mjs';
import { spawnSync } from 'node:child_process';
export default async function run({ root, artifactDir }) {
  await validateArtifact(root, artifactDir);
  const result = spawnSync(process.execPath, ['--test', 'tests/foundation.test.mjs'], { cwd: root, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || `Foundation tests exited ${result.status}`);
  return { status: 'PASS_LOCAL' };
}
