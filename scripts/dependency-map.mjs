export function dependencyNumbers(source) {
  const aggregate = /^\s*every required leaf below/i.test(source);
  const local = aggregate ? [...source.matchAll(/^- \[ \] #(\d+)\b/gm)].map(match => Number(match[1])) :
    [...source.matchAll(/(?:^|[^\w/])#(\d+)\b|https:\/\/github\.com\/Jevelopers-neatHack-2026\/shared-contracts\/issues\/(\d+)\b/g)].map(match => Number(match[1] ?? match[2]));
  return [...new Set(local)].sort((a, b) => a - b);
}
export function dependencyErrors(requirements, authority) {
  const failures = [];
  for (const source of authority.issues) {
    const row = requirements.issues.find(row => row.issue === source.issue);
    const expected = dependencyNumbers(source.blocked_by_source);
    if (!row || row.body_sha256 !== source.body_sha256 || JSON.stringify([...row.dependencies].sort((a, b) => a - b)) !== JSON.stringify(expected)) failures.push({ code: 'AUTHORITATIVE_DEPENDENCY_MISMATCH', issue: source.issue });
    if (row && JSON.stringify([...row.artifact_dependencies].sort((a, b) => a - b)) !== JSON.stringify(source.issue === 3 ? [] : expected)) failures.push({ code: 'ARTIFACT_DEPENDENCY_MISMATCH', issue: source.issue });
    if (row && JSON.stringify([...row.closure_dependencies].sort((a, b) => a - b)) !== JSON.stringify(source.issue === 3 ? expected : [])) failures.push({ code: 'CLOSURE_DEPENDENCY_MISMATCH', issue: source.issue });
  }
  return failures;
}
export function deliverableGraph(requirements) {
  const nodes = [
    { id: '4:inventory-inspection', issue: 4, requires: [] },
    { id: '4:inventory-toolchain-agreement', issue: 4, requires: ['4:inventory-inspection'] },
    { id: '5:toolchain-implementation', issue: 5, requires: ['4:inventory-toolchain-agreement'] },
    { id: '4:machine-inventory-verification', issue: 4, requires: ['5:toolchain-implementation'] }
  ];
  const stage = issue => issue === 4 ? '4:machine-inventory-verification' : issue === 5 ? '5:toolchain-implementation' : issue + ':implementation';
  for (const row of requirements.issues.filter(row => row.issue >= 6)) nodes.push({ id: stage(row.issue), issue: row.issue, requires: row.artifact_dependencies.map(stage) });
  for (const row of requirements.issues.filter(row => row.issue >= 4)) nodes.push({ id: row.issue + ':closure-evidence', issue: row.issue, requires: [stage(row.issue)], acceptance: 'owner_consumer_review_and_merged_revision_pending' });
  for (const row of requirements.followups ?? []) {
    nodes.push({ id: row.issue + ':implementation', issue: row.issue, requires: row.artifact_dependencies.map(stage) });
    nodes.push({ id: row.issue + ':closure-evidence', issue: row.issue, requires: [row.issue + ':implementation'], acceptance: 'independent_owner_consumer_review_and_merged_verification_pending' });
  }
  nodes.push({ id: '3:release-gate-evidence', issue: 3, requires: requirements.issues.find(row => row.issue === 3).closure_dependencies.map(issue => issue + ':closure-evidence') });
  nodes.push({ id: '1:epic-completion', issue: 1, requires: ['3:release-gate-evidence'] });
  return nodes;
}
export function graphErrors(nodes) {
  const ids = new Map(nodes.map(node => [node.id, node]));
  const active = new Set(), done = new Set(), failures = [];
  function visit(id) {
    if (!ids.has(id)) { failures.push({ code: 'MISSING_DEPENDENCY_DELIVERABLE', id }); return; }
    if (active.has(id)) { failures.push({ code: 'DELIVERABLE_DEPENDENCY_CYCLE', id }); return; }
    if (done.has(id)) return;
    active.add(id);
    for (const dependency of ids.get(id).requires) visit(dependency);
    active.delete(id); done.add(id);
  }
  for (const id of ids.keys()) visit(id);
  return failures;
}
