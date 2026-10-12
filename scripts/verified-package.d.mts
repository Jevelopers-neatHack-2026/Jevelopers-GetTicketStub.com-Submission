export function findShadowNodeModules(root: string, options?: { boundRoot?: string }): string[];
export function checkPackageResolution(root: string, options?: { boundRoot?: string }): string | null;
export function importVerified(resolved: string, root: string, options?: { boundRoot?: string }): Promise<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
