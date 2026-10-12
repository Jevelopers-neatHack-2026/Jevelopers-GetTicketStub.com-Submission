import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(readFileSync(resolve(repositoryRoot, "package-lock.json"), "utf8"));
const packageName = `@typescript/typescript-${process.platform}-${process.arch}`;
const lockEntry = lock.packages?.[`node_modules/${packageName}`];

if (!lockEntry || lockEntry.version !== "7.0.2" || lockEntry.optional !== true) {
  throw new Error(`No exact TypeScript 7.0.2 host package is recorded for ${process.platform}-${process.arch}`);
}
if (!lockEntry.os?.includes(process.platform) || !lockEntry.cpu?.includes(process.arch)) {
  throw new Error(`The locked TypeScript host package does not support ${process.platform}-${process.arch}`);
}

const install = spawnSync(
  "npm",
  [
    "install",
    "--no-save",
    "--package-lock=false",
    "--omit=optional",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    `${packageName}@7.0.2`,
  ],
  { cwd: repositoryRoot, stdio: "inherit" },
);

if (install.error) throw install.error;
if (install.status !== 0) process.exit(install.status ?? 1);

const installed = JSON.parse(
  readFileSync(resolve(repositoryRoot, "node_modules", packageName, "package.json"), "utf8"),
);
if (installed.name !== packageName || installed.version !== "7.0.2") {
  throw new Error("The installed TypeScript host package does not match the pinned package and version");
}

process.stdout.write(`Installed ${packageName}@7.0.2 for local typechecking.\n`);
