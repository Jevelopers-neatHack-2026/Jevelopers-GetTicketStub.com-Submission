/**
 * Presentation context supplied by the host. This is not server authorization and never a credential:
 * the server entry derives it from a verified host session (see `toHostAccessProjection`) and accepts none back.
 */
export type HostScope = Readonly<{ tenantId: string; projectId: string }>;
export type HostAccess =
  | { status: 'authorized'; scope: HostScope; revision: string }
  | { status: 'loading' }
  | { status: 'restricted' }
  | { status: 'unavailable' };
export function isAuthorized(access: HostAccess | undefined): access is Extract<HostAccess, { status: 'authorized' }> {
  return access?.status === 'authorized' && typeof access.revision === 'string' && access.revision.trim().length > 0
    && typeof access.scope?.tenantId === 'string' && access.scope.tenantId.trim().length > 0
    && typeof access.scope?.projectId === 'string' && access.scope.projectId.trim().length > 0;
}
