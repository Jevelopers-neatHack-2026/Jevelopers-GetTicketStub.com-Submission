import type { HostAccess } from '../../src';
export const fixtureAccess: HostAccess = { status: 'authorized', scope: { tenantId: 'fixture-tenant-a', projectId: 'fixture-project-a' }, revision: 'fixture-grant-v1' };
export const fixtureIds = ['td01-loading', 'td01-empty', 'td01-error', 'td01-restricted', 'td01-unavailable', 'td01-extension', 'td01-missing-auth', 'td01-scope-race'] as const;
