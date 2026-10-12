import standalone from 'ajv/dist/standalone/index.js';
import { build } from 'esbuild';

export const productionNames = new Set(['ProductionReference', 'ProductionPolicy', 'ProductionRuntime', 'ProductionResource', 'ProductionDiagnostic', 'ProductionError', 'ArtifactRef', 'JobRef', 'ComposeArtifactRequest', 'PersonalizeBatchRequest', 'InspectArtifactRequest', 'ExportBundleRequest', 'CompareTemplateRequest', 'ArtifactStatusRequest', 'TemplateSpec', 'Composition', 'PersonalizationSchema', 'CompatibilityReport', 'PreflightReport', 'ArtifactFile', 'ProductionBundleDetached', 'ProductionBundleRef', 'RowResult', 'BatchResult', 'ArtifactManifestStatus', 'CsvDialect', 'CsvMapping', 'CsvCheckpoint']);
export function productionSchema(schema) {
  return productionNames.has(schema.title) || schema.title === 'ProductionExecutionPins' || (schema.title === 'ProductionBundle' && schema.properties.schema_version.const === '2.0.0');
}

/** Two independent standalone bundles retain each finite package-member bound. */
export async function validatorModules(ajv, exports, root) {
  const production = Object.fromEntries(Object.entries(exports).filter(([, id]) => productionNames.has(id.split('/')[3]) || id.split('/')[3] === 'ProductionExecutionPins' || id === 'https://schemas.jevelopers.org/ProductionBundle/2.0.0'));
  const baseline = Object.fromEntries(Object.entries(exports).filter(([name]) => !Object.hasOwn(production, name)));
  const modules = [];
  for (const [filename, definitions] of [['validators.mjs', baseline], ['production-validators.mjs', production]]) {
    const bundled = await build({ stdin: { contents: standalone.default(ajv, definitions), resolveDir: root, sourcefile: filename }, bundle: true, write: false, metafile: true, format: 'esm', platform: 'node', target: 'node22', legalComments: 'none' });
    if (Object.values(bundled.metafile.outputs).some(output => output.imports.length)) throw new Error('Standalone validators require a runtime dependency');
    const contents = bundled.outputFiles[0].text.trimEnd() + '\n' + (filename === 'validators.mjs' ? "export * from './production-validators.mjs';\n" : '');
    if (Buffer.byteLength(contents) > 16777216) throw new Error('Generated validator exceeds the 16MiB package-member bound: ' + filename);
    modules.push({ filename, contents, bundled });
  }
  return modules;
}
