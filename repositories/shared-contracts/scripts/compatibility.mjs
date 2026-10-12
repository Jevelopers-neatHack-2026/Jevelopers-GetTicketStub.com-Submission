import { canonicalJson } from '../tooling/runtime.mjs';

/** Conservative impact classification; owner-reviewed fixtures still decide integration. */
export function schemaImpact(before, after, path = '') {
  const ignored = new Set(['description', 'title', '$comment', 'examples']);
  const clean = schema => {
    if (typeof schema !== 'object' || schema === null) return schema;
    return Object.fromEntries(Object.entries(schema).filter(([key]) => !ignored.has(key)).map(([key, child]) => {
      if (['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas'].includes(key)) return [key, Object.fromEntries(Object.entries(child).map(([name, field]) => [name, clean(field)]))];
      if (['allOf', 'anyOf', 'oneOf', 'prefixItems'].includes(key)) return [key, child.map(clean)];
      if (['items', 'additionalProperties', 'unevaluatedProperties', 'not', 'if', 'then', 'else', 'contains', 'propertyNames'].includes(key)) return [key, clean(child)];
      return [key, child];
    }));
  };
  if (canonicalJson(clean(before)) === canonicalJson(clean(after))) return { impact: 'compatible_documentation', changes: [] };
  const changes = [];
  const record = (code, suffix = '') => changes.push({ code, path: path + suffix });
  for (const key of after.required ?? []) if (!(before.required ?? []).includes(key)) record('required_addition', '/' + key);
  for (const key of Object.keys(before.properties ?? {})) if (!Object.hasOwn(after.properties ?? {}, key)) record('field_removal', '/' + key);
  if (canonicalJson(before.type ?? null) !== canonicalJson(after.type ?? null)) record('type_change');
  if (canonicalJson(before.enum ?? null) !== canonicalJson(after.enum ?? null)) record('unsafe_enum_change');
  for (const key of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'pattern', 'format', 'additionalProperties', 'const', '$ref', 'minItems', 'maxItems']) if (canonicalJson(before[key] ?? null) !== canonicalJson(after[key] ?? null)) record('constraint_or_semantic_change', '/' + key);
  for (const [key, child] of Object.entries(after.properties ?? {})) if (Object.hasOwn(before.properties ?? {}, key)) changes.push(...schemaImpact(before.properties[key], child, path + '/' + key).changes);
  if (!changes.length) record('schema_change_requires_review');
  return { impact: 'breaking_or_unproven', changes };
}
