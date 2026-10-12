import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateContent } from './content.mjs';
import { exerciseJourney, validatePrivacySource } from './privacy.mjs';

export function sourceConfig(html) {
  const matches = [...html.matchAll(/\/\* CTA_CONFIG_BEGIN \*\/\s*const CTA_CONFIG = ([\s\S]*?);\s*\/\* CTA_CONFIG_END \*\//g)];
  assert.equal(matches.length, 1, 'Exactly one static CTA configuration required');
  return JSON.parse(matches[0][1]);
}
export function fixtureSource(html, config) {
  sourceConfig(html);
  return html.replace(/(\/\* CTA_CONFIG_BEGIN \*\/\s*const CTA_CONFIG = )[\s\S]*?(;\s*\/\* CTA_CONFIG_END \*\/)/, (_, begin, end) => begin + JSON.stringify(config) + end);
}
export function validateCtaSource(html, config) {
  assert.deepEqual(sourceConfig(html), config, 'Unreviewed CTA config/source drift');
  assert.equal(config.schema, 'ticketstub.cta/1');
  assert.equal(config.capture, 'deferred', 'Capture activation requires separate owner-reviewed scope');
  assert.ok(['preview','demo','staging','production'].includes(config.environment), 'Unknown CTA environment');
  assert.ok(!/<form\b/i.test(html), 'No native submitting/capture form in link-only mode');
  const input = html.match(/<input\b[^>]*id="ev"[^>]*>/i)?.[0];
  assert.ok(input && !/\bname\s*=/i.test(input), 'Local input must have no submit name');
  assert.match(html, /<div class="maker" id="maker" role="group"/);
  assert.match(html, /<button class="btn punch" type="button">[\s\S]*?Update preview/);
  assert.ok(!/STUDIO_URL|URLSearchParams|Sent to the studio|Opening the TicketStub studio|gvk66o79l1/.test(html), 'External text handoff or false send confirmation returned');
  assert.match(html, /id="demoUnavailable" role="status"/);
  assert.match(html, /\.finale\.typing \.fin-copy>p:not\(#demoUnavailable\)\{display:none\}/);
  assert.ok(!/\.fin-note\{display:none\}/.test(html), 'Local feedback must remain visible on mobile');
  const result = exerciseJourney(html);
  // Runtime withdrawal cannot modify noscript markup. Every shipped native link
  // must match the current approved config, including the no-JS escape route.
  for (const tag of html.matchAll(/<a\b[^>]*>/gi)) {
    const href = tag[0].match(/\bhref="([^"]+)"/)?.[1];
    if (href && !href.startsWith('#')) assert.equal(href, result.destination, 'Static native link differs from approved destination or remains after withdrawal');
  }
  const entry = config.destinations[config.environment];
  if (entry?.status !== 'APPROVED' || entry.availability !== 'verified') assert.equal(result.destination, null, 'Pending/unavailable destination must remain disabled');
  const link = html.match(/<a\b[^>]*id="demoLink"[^>]*>/)?.[0];
  assert.ok(link, 'Studio placement missing');
  const href = link.match(/\bhref="([^"]*)"/)?.[1] || null;
  assert.equal(href, result.destination, 'Native studio href differs from approved runtime destination');
  assert.match(html, /id="demoLink"[^>]*>Open studio<\/a>/);
  return result;
}
export default async function run({ root, artifactDir, mode = 'release' }) {
  const config = JSON.parse(await readFile(resolve(root, 'src/content/cta.json'), 'utf8'));
  const decision = JSON.parse(await readFile(resolve(root, 'review/cta-navigation-decision.json'), 'utf8'));
  assert.deepEqual(config.destinations.preview.receipt, decision, 'Owner navigation receipt/config drift');
  assert.equal(decision.scope, 'public-navigation-only');
  const copy = JSON.parse(await readFile(resolve(root, 'src/content/copy.json'), 'utf8'));
  const privacy = JSON.parse(await readFile(resolve(root, 'review/privacy-inventory.json'), 'utf8'));
  const html = await readFile(resolve(root, 'site/index.html'), 'utf8');
  validateContent(html, copy, { mode: 'draft' });
  validatePrivacySource(html, privacy);
  const result = validateCtaSource(html, config);
  if (artifactDir) validateCtaSource(await readFile(resolve(artifactDir, 'index.html'), 'utf8'), config);
  const tests = spawnSync(process.execPath, ['--test', 'tests/cta.test.mjs'], { cwd: root, stdio: 'inherit' });
  if (tests.error || tests.status !== 0) throw new Error(tests.error?.message || `CTA tests exited ${tests.status}`);
  if (mode === 'release') {
    assert.ok(result.destination, 'CTA destination approval/reachability pending: current link is disabled');
    throw new Error('Release CTA deployed revision/artifact identity, broader owner acceptance and browser evidence pending; navigation-only approval cannot pass release');
  }
  assert.equal(mode, 'draft');
  console.log('cta: local input stays local; no form/query handoff; owner-approved Open studio navigation only; deployment/release/browser evidence PENDING');
  return { status: 'PASS_DRAFT' };
}
