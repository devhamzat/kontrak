import type { AnySchema } from 'ajv';
import { isRecord, resolvePointer } from './refs';
import type { OpenApiVersion } from './types';

export function bundleSchema(
  document: Record<string, unknown>,
  schema: AnySchema,
  version: OpenApiVersion,
): AnySchema {
  if (typeof schema === 'boolean') return schema;
  const definitions = new Map<string, AnySchema>();
  const visiting = new Set<string>();

  const transform = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(transform);
    if (!isRecord(value)) return value;

    const transformed: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (
        key === '$ref' &&
        typeof child === 'string' &&
        child.startsWith('#/components/schemas/')
      ) {
        const name = child
          .slice('#/components/schemas/'.length)
          .replace(/~1/g, '/')
          .replace(/~0/g, '~');
        if (!definitions.has(name) && !visiting.has(name)) {
          visiting.add(name);
          const resolved = resolvePointer(document, child);
          if (typeof resolved !== 'boolean' && !isRecord(resolved)) {
            throw new Error(
              `Schema reference "${child}" does not resolve to a schema.`,
            );
          }
          definitions.set(name, transform(resolved) as AnySchema);
          visiting.delete(name);
        }
        transformed.$ref = `#/$defs/${escapePointer(name)}`;
        continue;
      }
      transformed[key] = transform(child);
    }

    if (version === '3.0') normalizeOpenApi30Schema(transformed);
    return transformed;
  };

  const root = transform(schema) as Record<string, unknown>;
  if (definitions.size > 0 && typeof root !== 'boolean') {
    root.$defs = Object.fromEntries(definitions);
  }
  return root;
}

function normalizeOpenApi30Schema(schema: Record<string, unknown>): void {
  if (schema.nullable === true) {
    const original = { ...schema };
    delete original.nullable;
    for (const key of Object.keys(schema)) delete schema[key];
    schema.anyOf = [original, { type: 'null' }];
    return;
  }
  delete schema.nullable;

  if (schema.exclusiveMinimum === true && typeof schema.minimum === 'number') {
    schema.exclusiveMinimum = schema.minimum;
    delete schema.minimum;
  } else if (schema.exclusiveMinimum === false) {
    delete schema.exclusiveMinimum;
  }
  if (schema.exclusiveMaximum === true && typeof schema.maximum === 'number') {
    schema.exclusiveMaximum = schema.maximum;
    delete schema.maximum;
  } else if (schema.exclusiveMaximum === false) {
    delete schema.exclusiveMaximum;
  }
}

function escapePointer(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}
