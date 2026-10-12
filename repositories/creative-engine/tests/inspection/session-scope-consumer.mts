import type { CreativeRuntimePorts, InspectionSessionRecord } from "../../src/api/v1.mjs";

type InspectionStorage = NonNullable<CreativeRuntimePorts["storage"]>;
type GetInspectionSession = NonNullable<InspectionStorage["getInspectionSession"]>;
type GetInspectionSessionInput = Parameters<GetInspectionSession>[0];
type ExpectedScope = { tenant_id: string; project_id: string; brief_id: string };

export function assertInspectionSessionScope(
  session: InspectionSessionRecord | null,
  expected: ExpectedScope,
): InspectionSessionRecord {
  if (!session) throw new Error("inspection session is missing");
  if (session.scope.tenant_id !== expected.tenant_id ||
    session.scope.project_id !== expected.project_id ||
    session.scope.brief_id !== expected.brief_id ||
    session.brief_id !== expected.brief_id) {
    throw new Error("inspection session scope does not match the expected identity");
  }
  if (!Object.isFrozen(session) || !Object.isFrozen(session.scope)) {
    throw new Error("inspection session identity must be immutable");
  }
  if (Reflect.set(session, "scope", { ...expected }) ||
    Reflect.set(session.scope, "tenant_id", `${expected.tenant_id}:mutated`)) {
    throw new Error("inspection session scope accepted caller mutation");
  }
  return session;
}

export async function readInspectionSessionScope(
  storage: InspectionStorage,
  input: GetInspectionSessionInput,
  expected: ExpectedScope,
): Promise<InspectionSessionRecord> {
  if (!storage.getInspectionSession) throw new Error("getInspectionSession is unavailable");
  return assertInspectionSessionScope(await storage.getInspectionSession(input), expected);
}
