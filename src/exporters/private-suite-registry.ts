export const suiteNames = [
	"runtime",
	"api-contracts",
	"templates",
	"composition",
	"typography",
	"approved-assets",
	"artifact-storage",
	"preflight",
	"bounded-repair",
	"personalization",
	"csv-personalization",
	"exporters",
	"manifests",
	"restart-recovery",
	"metering-traces",
	"integration-production",
	"release",
] as const;
export type SuiteName = (typeof suiteNames)[number];
export const suiteRegistry = {
	runtime: { state: "implemented", dependency: "PP-01A local calibration" },
	"api-contracts": {
		state: "unimplemented",
		dependency:
			"PP-01B canonical shared-contracts package and immutable commit pin",
	},
	templates: {
		state: "external-blocked",
		dependency:
			"PP-03 private template engine tested; canonical adapter, approved roster and confirmed supplier specification absent",
	},
	composition: {
		state: "external-blocked",
		dependency:
			"PP-02 private composition tested; canonical creative/fact/approval adapters and real approved input pins absent",
	},
	typography: {
		state: "external-blocked",
		dependency:
			"PP-04 private typography tested; real approved field/font policies and exporter content conformance absent",
	},
	"approved-assets": {
		state: "external-blocked",
		dependency:
			"PP-05 private asset checks tested; canonical authoritative permission lookup and real approved asset fixtures absent",
	},
	"artifact-storage": {
		state: "external-blocked",
		dependency:
			"PP-10A private adapter tested; accepted canonical request/hash/scope adapter and app access fixtures absent",
	},
	preflight: {
		state: "external-blocked",
		dependency:
			"PP-07 private preflight tested; real supplier constraints, final exporter profile/content checks and canonical ProductionBundle status absent",
	},
	"bounded-repair": {
		state: "external-blocked",
		dependency:
			"PP-08 private bounded repair tested; real mechanical permission, canonical approval applicability and final export checks absent",
	},
	personalization: {
		state: "external-blocked",
		dependency:
			"PP-06A private structured engine tested; canonical row requests and approved template/authorization absent",
	},
	"csv-personalization": {
		state: "external-blocked",
		dependency:
			"PP-06B private streaming adapter tested conditionally; approved CSV launch roster absent",
	},
	exporters: {
		state: "external-blocked",
		dependency:
			"PP-09A real local files inspected; supplier roster/spec and required PDF Unicode/wrap cases remain blocked",
	},
	manifests: {
		state: "external-blocked",
		dependency:
			"PP-09B private inventory only; canonical ProductionBundle and accepted hashing adapter absent",
	},
	"restart-recovery": {
		state: "external-blocked",
		dependency:
			"PP-10B private recovery tested; canonical job/row semantics, structured personalization and ProductionBundle ports absent",
	},
	"metering-traces": {
		state: "external-blocked",
		dependency:
			"PP-11 private staged observations tested; accepted UsageEvent/EvaluationEvidence, real finance intake and Neatlogs ports absent",
	},
	"integration-production": {
		state: "external-blocked",
		dependency:
			"PP-12F local corpus tested; real canonical/app/finance/fulfillment consumer pins absent",
	},
	release: {
		state: "aggregate",
		dependency: "Every registered leaf and verified immutable external pins",
	},
} as const satisfies Record<
	SuiteName,
	{
		readonly state:
			| "implemented"
			| "unimplemented"
			| "aggregate"
			| "external-blocked";
		readonly dependency: string;
	}
>;
