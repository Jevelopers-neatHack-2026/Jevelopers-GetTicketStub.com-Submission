import type { ProductionContext } from "@jevelopers/shared-contracts/production-operations";
import type { CanonicalProfile } from "./canonical-host.js";
import { freeze } from "../composition/primitives.js";
export function bindCanonicalContext(
	context: ProductionContext,
): ProductionContext {
	return freeze({
		...context,
		scope: { ...context.scope },
		authority: { ...context.authority },
		runtime: structuredClone(context.runtime),
		clock: { now: context.clock.now.bind(context.clock) },
		references: {
			resolve: context.references.resolve.bind(context.references),
		},
		authorization: {
			verify: context.authorization.verify.bind(context.authorization),
		},
		assets: {
			resolve: context.assets.resolve.bind(context.assets),
			verifyPermission: context.assets.verifyPermission.bind(context.assets),
		},
		templates: {
			resolve: context.templates.resolve.bind(context.templates),
		},
		storage: {
			readStatus: context.storage.readStatus.bind(context.storage),
			publish: context.storage.publish.bind(context.storage),
		},
		metering: {
			observe: context.metering.observe.bind(context.metering),
		},
	});
}
export function snapshotCanonicalProfiles(
	profiles: readonly CanonicalProfile[],
): readonly CanonicalProfile[] {
	return profiles.map((p) => {
		const { private_permissions, ...data } = p;
		return freeze({
			...structuredClone(data),
			private_permissions: {
				resolve: private_permissions.resolve.bind(private_permissions),
				permission: private_permissions.permission.bind(private_permissions),
				compositionPermission:
					private_permissions.compositionPermission.bind(private_permissions),
			},
		});
	});
}
