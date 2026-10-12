import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildSite, root } from './build.mjs';
export const requiredSuites = ['foundation', 'content', 'cta', 'proof', 'ux', 'brand', 'privacy', 'metadata', 'governance'];
export async function main(args = process.argv.slice(2), { repository = root } = {}) {
  const options = new Map();
  let invalid = args.length % 2 !== 0;
  for (let i = 0; i < args.length; i += 2) {
    const [key, value] = args.slice(i, i + 2);
    if (!['--suite','--mode'].includes(key) || options.has(key)) invalid = true;
    options.set(key,value);
  }
  const suite = options.get('--suite');
  const mode = options.has('--mode') ? options.get('--mode') : 'release';
  if (invalid || (options.has('--suite') && !requiredSuites.includes(suite)) || !['draft','release'].includes(mode)) {
    console.error(`Usage: ./scripts/validate-landing [--suite ${requiredSuites.join('|')}] [--mode draft|release]`);
    process.exitCode = 2; return;
  }
  const selected = suite ? [suite] : requiredSuites;
  let failed = false;
  let draft = false;
  const artifactDir = resolve(repository, 'dist/site');
  await buildSite({ repository });
  for (const name of selected) {
    const location = resolve(repository, 'scripts/suites', `${name}.mjs`);
    try { await access(location); }
    catch {
      console.error(`FAIL ${name}: required validator unavailable. Implement scripts/suites/${name}.mjs under its LP issue; this check is not a pass.`);
      failed = true; continue;
    }
    try {
      const module = await import(pathToFileURL(location).href);
      if (typeof module.default !== 'function') throw new Error('Suite must export a default validation function');
      const result = await module.default({ root: repository, artifactDir, mode });
      const status = result?.status;
      if (!['PASS','PASS_LOCAL','PASS_DRAFT'].includes(status)) throw new Error('Suite must return an explicit PASS, PASS_LOCAL or PASS_DRAFT status');
      if (mode === 'release' && status === 'PASS_DRAFT') throw new Error('Draft evidence cannot pass release validation; resolve approvals/prerequisites first');
      draft ||= status === 'PASS_DRAFT';
      console.log(`${status} ${name}`);
    } catch (error) { console.error(`FAIL ${name}: ${error.message}`); failed = true; }
  }
  if (!failed && draft) console.log('PASS_DRAFT selected suites: release approvals remain pending');
  process.exitCode = failed ? 1 : 0;
}
