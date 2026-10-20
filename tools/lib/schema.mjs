// A small JSON Schema subset validator, enough for the schemas in schema/.
// Supported: type, enum, const, pattern, minLength, maxLength, required, properties,
// additionalProperties (boolean), items, allOf, if/then/else.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './paths.mjs';

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
}

function typeMatches(want, v) {
  const t = typeOf(v);
  if (want === 'number') return t === 'number' || t === 'integer';
  return want === t;
}

export function validateSchema(schema, value, path = '') {
  const errors = [];
  const at = path || '(root)';
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeMatches(t, value))) {
      errors.push(`${at}: expected ${types.join(' or ')}, got ${typeOf(value)}`);
      return errors;
    }
  }
  if (schema.const !== undefined && value !== schema.const) errors.push(`${at}: must be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${at}: must be one of ${schema.enum.map((x) => JSON.stringify(x)).join(', ')}`);
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && [...value].length < schema.minLength) errors.push(`${at}: shorter than ${schema.minLength} characters`);
    if (schema.maxLength !== undefined && [...value].length > schema.maxLength) errors.push(`${at}: longer than ${schema.maxLength} characters`);
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) errors.push(`${at}: does not match the required format`);
  }
  if (typeOf(value) === 'object') {
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${at}: missing required field "${key}"`);
    }
    const props = schema.properties ?? {};
    for (const [key, v] of Object.entries(value)) {
      if (props[key]) errors.push(...validateSchema(props[key], v, path ? `${path}.${key}` : key));
      else if (schema.additionalProperties === false) errors.push(`${at}: unknown field "${key}"`);
    }
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((v, i) => errors.push(...validateSchema(schema.items, v, `${path}[${i}]`)));
  }
  for (const sub of schema.allOf ?? []) errors.push(...validateSchema(sub, value, path));
  if (schema.if) {
    const ok = validateSchema(schema.if, value, path).length === 0;
    if (ok && schema.then) errors.push(...validateSchema(schema.then, value, path));
    if (!ok && schema.else) errors.push(...validateSchema(schema.else, value, path));
  }
  return errors;
}

const cache = new Map();
export function loadSchema(name) {
  if (!cache.has(name)) cache.set(name, JSON.parse(readFileSync(join(ROOT, 'schema', name), 'utf8')));
  return cache.get(name);
}
