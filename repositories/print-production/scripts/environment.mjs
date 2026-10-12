// This bootstrap is dependency-free so npm ci can enforce pins before installation.
export const nodePin = "24.21.0";
export const npmPin = "11.19.0";
const agent = process.env.npm_config_user_agent ?? "";
if (process.versions.node !== nodePin || !agent.startsWith(`npm/${npmPin} `)) {
	console.error(
		JSON.stringify({
			code: "ENVIRONMENT_PIN_MISMATCH",
			expectedNode: nodePin,
			expectedNpm: npmPin,
		}),
	);
	process.exitCode = 1;
}
