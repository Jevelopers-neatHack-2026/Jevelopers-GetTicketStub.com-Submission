import assert from 'node:assert/strict';

// Bounded offline interpreter for the exact pinned fixtures' JSON Schema vocabulary.
// Unsupported validation keywords fail closed; external references resolve only in supplied bytes.
const keywords = new Set(['$id', '$schema', '$defs', '$ref', 'title', 'description', 'tsType',
  'x-classification', 'x-combined-validator', 'x-schema-completeness', 'type', 'const', 'enum',
  'anyOf', 'oneOf', 'required', 'properties', 'propertyNames', 'additionalProperties',
  'minProperties', 'maxProperties', 'items', 'minItems', 'maxItems', 'uniqueItems',
  'minimum', 'maximum', 'minLength', 'maxLength', 'pattern', 'format']);
const stable = value => JSON.stringify(value, (_key, item) => item && !Array.isArray(item) && typeof item === 'object'
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

export function validateFixtureSchema(schema, value, documents = []) {
  const roots = new Map([schema, ...documents].map(document => [document.$id, document]));
  let budget = 200000;
  function audit(rule) {
    assert.ok(--budget > 0, 'Fixture schema budget exceeded');
    assert.ok(rule && typeof rule === 'object' && !Array.isArray(rule), 'Unsupported schema rule');
    for (const key of Object.keys(rule)) assert.ok(keywords.has(key), `Unsupported schema keyword: ${key}`);
    for (const key of ['$defs','properties']) for (const child of Object.values(rule[key] ?? {})) audit(child);
    for (const key of ['anyOf','oneOf']) for (const child of rule[key] ?? []) audit(child);
    for (const key of ['items','propertyNames','additionalProperties']) if (typeof rule[key] === 'object') audit(rule[key]);
  }
  for (const document of [schema,...documents]) audit(document);
  function check(rule, item, root, path) {
    assert.ok(--budget > 0, 'Fixture schema budget exceeded');
    for (const key of Object.keys(rule)) assert.ok(keywords.has(key), `Unsupported schema keyword: ${key}`);
    if (rule.$ref) {
      const [uri, pointer = ''] = rule.$ref.split('#');
      const document = uri ? roots.get(uri) : root;
      assert.ok(document, `Unpinned schema reference: ${uri}`);
      let referenced = document;
      for (const key of pointer.split('/').slice(1)) referenced = referenced?.[key.replaceAll('~1', '/').replaceAll('~0', '~')];
      assert.ok(referenced, `Missing schema reference: ${rule.$ref}`);
      check(referenced, item, document, path);
    }
    if ('const' in rule) assert.deepEqual(item, rule.const, path);
    if (rule.enum) assert.ok(rule.enum.some(expected => stable(expected) === stable(item)), path);
    for (const keyword of ['anyOf', 'oneOf']) if (rule[keyword]) {
      const matches = rule[keyword].filter(branch => {
        try { check(branch, item, root, path); return true; } catch (error) {
          if (/Unsupported schema|Unpinned schema|Missing schema|budget exceeded/.test(error.message)) throw error;
          return false;
        }
      }).length;
      assert.ok(keyword === 'oneOf' ? matches === 1 : matches > 0, path);
    }
    if (rule.type) {
      const actual = item === null ? 'null' : Array.isArray(item) ? 'array' : typeof item;
      assert.ok(rule.type === 'integer' ? Number.isSafeInteger(item) : actual === rule.type, path);
    }
    if (typeof item === 'string') {
      const length = [...item].length;
      if (rule.minLength !== undefined) assert.ok(length >= rule.minLength, path);
      if (rule.maxLength !== undefined) assert.ok(length <= rule.maxLength, path);
      if (rule.pattern) assert.ok(new RegExp(rule.pattern, 'u').test(item), path);
      if (rule.format) {
        assert.ok(['date-time', 'utc-time', 'uuid'].includes(rule.format), `Unsupported schema format: ${rule.format}`);
        assert.ok(rule.format === 'uuid' ? /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(item)
          : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(item) && Number.isFinite(Date.parse(item)), path);
        if (rule.format === 'utc-time') assert.ok(item.endsWith('Z'), path);
        if (rule.format !== 'uuid') {
          const [year,month,day,hour,minute,second]=item.match(/\d+/gu).slice(0,6).map(Number);
          assert.ok(month>=1&&month<=12&&day>=1&&day<=new Date(Date.UTC(year,month,0)).getUTCDate()
            &&hour<=23&&minute<=59&&second<=59,path);
        }
      }
    }
    if (typeof item === 'number') {
      assert.ok(Number.isFinite(item), path);
      if (rule.minimum !== undefined) assert.ok(item >= rule.minimum, path);
      if (rule.maximum !== undefined) assert.ok(item <= rule.maximum, path);
    }
    if (Array.isArray(item)) {
      if (rule.minItems !== undefined) assert.ok(item.length >= rule.minItems, path);
      if (rule.maxItems !== undefined) assert.ok(item.length <= rule.maxItems, path);
      if (rule.uniqueItems) assert.equal(new Set(item.map(stable)).size, item.length, path);
      if (rule.items) item.forEach((value, index) => check(rule.items, value, root, `${path}/${index}`));
    } else if (item !== null && typeof item === 'object') {
      if (rule.minProperties !== undefined) assert.ok(Object.keys(item).length >= rule.minProperties, path);
      if (rule.maxProperties !== undefined) assert.ok(Object.keys(item).length <= rule.maxProperties, path);
      for (const key of rule.required ?? []) assert.ok(Object.hasOwn(item, key), `${path}/${key}`);
      for (const [key, value] of Object.entries(item)) {
        if (rule.propertyNames) check(rule.propertyNames, key, root, path);
        if (Object.hasOwn(rule.properties ?? {}, key)) check(rule.properties[key], value, root, `${path}/${key}`);
        else if (rule.additionalProperties === false) assert.fail(`${path}/${key}: unexpected property`);
        else if (typeof rule.additionalProperties === 'object') check(rule.additionalProperties, value, root, `${path}/${key}`);
      }
    }
  }
  check(schema, value, schema, '$');
}
