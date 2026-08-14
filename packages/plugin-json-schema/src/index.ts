import type {
  ContractDocument,
  ContractValidationResult,
  ExchangeSummary,
  LocalExchange,
  MatchResult,
} from '@kontrak/core';
import {
  PLUGIN_API_VERSION,
  bodyValue,
  definePlugin,
  diagnostic,
  type ContractInput,
  type ContractChange,
  type ContractPlugin,
  type ImportResult,
} from '@kontrak/plugin-sdk';
import Ajv, {
  type AnySchema,
  type ErrorObject,
  type ValidateFunction,
} from 'ajv';
import Ajv2019 from 'ajv/dist/2019.js';
import Ajv2020 from 'ajv/dist/2020.js';

export const JSON_SCHEMA_FORMAT = 'json-schema' as const;
export type JsonSchemaDialect = 'draft-07' | '2019-09' | '2020-12';
export type UrlPatternKind = 'literal' | 'regex';

export interface JsonSchemaContract {
  readonly schema: AnySchema;
  readonly dialect: JsonSchemaDialect;
  readonly method: string;
  readonly target: 'request' | 'response';
  readonly urlPattern: string;
  readonly urlPatternKind: UrlPatternKind;
}

const MAX_SOURCE_LENGTH = 1_000_000;
const MAX_SCHEMA_DEPTH = 100;

export function createJsonSchemaPlugin(): ContractPlugin<JsonSchemaContract> {
  const validators = new WeakMap<JsonSchemaContract, ValidateFunction>();

  return definePlugin<JsonSchemaContract>({
    format: JSON_SCHEMA_FORMAT,
    manifest: {
      id: '@kontrak/plugin-json-schema',
      name: 'Kontrak JSON Schema',
      version: '0.1.0',
      apiVersion: PLUGIN_API_VERSION,
      formats: [JSON_SCHEMA_FORMAT],
    },

    canImport(input) {
      if (input.mediaType === 'application/schema+json') return 1;
      if (typeof input.content === 'string') {
        try {
          const parsed = JSON.parse(input.content) as unknown;
          return isSchemaDocument(parsed) ? 0.8 : 0;
        } catch {
          return 0;
        }
      }
      return isSchemaDocument(input.content) ? 0.8 : 0;
    },

    import(input): ImportResult<JsonSchemaContract> {
      const parsed = parseSchema(input);
      if (parsed.schema === undefined)
        return { contracts: [], diagnostics: parsed.diagnostics };

      const configuration = parseConfiguration(input);
      if (!configuration.value) {
        return {
          contracts: [],
          diagnostics: [...parsed.diagnostics, ...configuration.diagnostics],
        };
      }

      const dialect = detectDialect(parsed.schema);
      if (!dialect.value) {
        return {
          contracts: [],
          diagnostics: [...parsed.diagnostics, ...dialect.diagnostics],
        };
      }

      const remoteReference = findRemoteReference(parsed.schema);
      if (remoteReference) {
        return {
          contracts: [],
          diagnostics: [
            ...parsed.diagnostics,
            diagnostic(
              'json-schema.remote_ref_disabled',
              `Remote reference "${remoteReference}" is disabled by default.`,
            ),
          ],
        };
      }

      const compiled: JsonSchemaContract = {
        schema: parsed.schema,
        dialect: dialect.value,
        ...configuration.value,
      };

      try {
        const validate = ajvFor(dialect.value).compile(parsed.schema);
        validators.set(compiled, validate);
      } catch (error) {
        return {
          contracts: [],
          diagnostics: [
            ...parsed.diagnostics,
            diagnostic(
              'json-schema.invalid_schema',
              error instanceof Error ? error.message : String(error),
            ),
          ],
        };
      }

      return {
        contracts: [
          {
            id: input.id,
            name: input.name,
            format: JSON_SCHEMA_FORMAT,
            formatVersion: dialect.value,
            compiled,
          },
        ],
        diagnostics: [...parsed.diagnostics, ...dialect.diagnostics],
      };
    },

    match(exchange, contract): MatchResult {
      const definition = contract.compiled;
      if (
        definition.method !== 'ALL' &&
        definition.method !== exchange.request.method.toUpperCase()
      ) {
        return { matched: false, score: 0, diagnostics: [] };
      }

      const matched =
        definition.urlPatternKind === 'literal'
          ? exchange.request.url.includes(definition.urlPattern)
          : new RegExp(definition.urlPattern).test(exchange.request.url);
      const score = matched
        ? definition.urlPatternKind === 'literal'
          ? 100 + definition.urlPattern.length
          : 50
        : 0;
      return { matched, score, diagnostics: [] };
    },

    validate(exchange, contract, match): ContractValidationResult {
      if (!match.matched) {
        return {
          exchangeId: exchange.id,
          contractId: contract.id,
          format: contract.format,
          status: 'skipped',
          diagnostics: [],
        };
      }

      const body = bodyValue(exchange, contract.compiled.target);
      if (!body.available) {
        return {
          exchangeId: exchange.id,
          contractId: contract.id,
          format: contract.format,
          status: 'skipped',
          diagnostics: [
            diagnostic('json-schema.body_unavailable', body.reason, {
              severity: 'warning',
              phase: contract.compiled.target,
            }),
          ],
        };
      }

      let validate = validators.get(contract.compiled);
      if (!validate) {
        validate = ajvFor(contract.compiled.dialect).compile(
          contract.compiled.schema,
        );
        validators.set(contract.compiled, validate);
      }
      const valid = validate(body.value);
      return {
        exchangeId: exchange.id,
        contractId: contract.id,
        format: contract.format,
        status: valid ? 'valid' : 'invalid',
        diagnostics: valid
          ? []
          : (validate.errors ?? []).map((error) =>
              validationDiagnostic(error, contract),
            ),
      };
    },

    diff(previous, next) {
      return diffJsonSchemas(previous.compiled, next.compiled);
    },
  });
}

function diffJsonSchemas(
  previous: JsonSchemaContract,
  next: JsonSchemaContract,
): ContractChange[] {
  const changes: ContractChange[] = [];
  if (previous.target !== next.target) {
    changes.push({
      code: 'json-schema.target_changed',
      message: `Validation target changed from ${previous.target} to ${next.target}.`,
      severity: 'breaking',
    });
  }
  if (
    typeof previous.schema === 'boolean' ||
    typeof next.schema === 'boolean'
  ) {
    if (previous.schema !== next.schema) {
      changes.push({
        code: 'json-schema.boolean_changed',
        message: 'Boolean schema behavior changed.',
        severity: next.schema === false ? 'breaking' : 'non-breaking',
        pointer: '/',
      });
    }
    return changes;
  }
  const previousProperties = isSchemaObject(previous.schema.properties)
    ? previous.schema.properties
    : {};
  const nextProperties = isSchemaObject(next.schema.properties)
    ? next.schema.properties
    : {};
  for (const name of Object.keys(previousProperties)) {
    if (!(name in nextProperties)) {
      changes.push({
        code: 'json-schema.property_removed',
        message: `Property "${name}" was removed.`,
        severity: 'breaking',
        pointer: `/properties/${escapePointer(name)}`,
      });
    }
  }
  const previousRequired = new Set(
    Array.isArray(previous.schema.required)
      ? previous.schema.required.filter(
          (value): value is string => typeof value === 'string',
        )
      : [],
  );
  const nextRequired = Array.isArray(next.schema.required)
    ? next.schema.required.filter(
        (value): value is string => typeof value === 'string',
      )
    : [];
  for (const name of nextRequired) {
    if (!previousRequired.has(name)) {
      changes.push({
        code: 'json-schema.required_added',
        message: `Property "${name}" became required.`,
        severity: 'breaking',
        pointer: '/required',
      });
    }
  }
  return changes;
}

function escapePointer(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function parseSchema(input: ContractInput): {
  schema?: AnySchema;
  diagnostics: ReturnType<typeof diagnostic>[];
} {
  if (
    typeof input.content === 'string' &&
    input.content.length > MAX_SOURCE_LENGTH
  ) {
    return {
      diagnostics: [
        diagnostic(
          'json-schema.source_too_large',
          `Schema source exceeds the ${MAX_SOURCE_LENGTH} character limit.`,
        ),
      ],
    };
  }

  try {
    const value =
      typeof input.content === 'string'
        ? (JSON.parse(input.content) as unknown)
        : input.content;
    if (!isSchemaDocument(value)) {
      return {
        diagnostics: [
          diagnostic(
            'json-schema.invalid_document',
            'A JSON Schema document must be an object or boolean.',
          ),
        ],
      };
    }
    if (depthOf(value) > MAX_SCHEMA_DEPTH) {
      return {
        diagnostics: [
          diagnostic(
            'json-schema.depth_exceeded',
            `Schema nesting exceeds the maximum depth of ${MAX_SCHEMA_DEPTH}.`,
          ),
        ],
      };
    }
    return { schema: value, diagnostics: [] };
  } catch (error) {
    return {
      diagnostics: [
        diagnostic(
          'json-schema.invalid_json',
          error instanceof Error ? error.message : String(error),
        ),
      ],
    };
  }
}

function parseConfiguration(input: ContractInput): {
  value?: Omit<JsonSchemaContract, 'schema' | 'dialect'>;
  diagnostics: ReturnType<typeof diagnostic>[];
} {
  const urlPattern = input.metadata?.urlPattern;
  const urlPatternKind = input.metadata?.urlPatternKind ?? 'literal';
  const method = input.metadata?.method ?? 'ALL';
  const target = input.metadata?.target ?? 'response';

  if (typeof urlPattern !== 'string' || urlPattern.length === 0) {
    return {
      diagnostics: [
        diagnostic(
          'json-schema.url_pattern_required',
          'metadata.urlPattern is required.',
        ),
      ],
    };
  }
  if (urlPatternKind !== 'literal' && urlPatternKind !== 'regex') {
    return {
      diagnostics: [
        diagnostic(
          'json-schema.pattern_kind_invalid',
          'metadata.urlPatternKind must be "literal" or "regex".',
        ),
      ],
    };
  }
  if (urlPatternKind === 'regex') {
    if (urlPattern.length > 256) {
      return {
        diagnostics: [
          diagnostic(
            'json-schema.regex_too_long',
            'Regular expressions are limited to 256 characters.',
          ),
        ],
      };
    }
    try {
      new RegExp(urlPattern);
    } catch (error) {
      return {
        diagnostics: [
          diagnostic(
            'json-schema.regex_invalid',
            error instanceof Error ? error.message : String(error),
          ),
        ],
      };
    }
  }
  if (typeof method !== 'string' || method.length === 0) {
    return {
      diagnostics: [
        diagnostic('json-schema.method_invalid', 'metadata.method is invalid.'),
      ],
    };
  }
  if (target !== 'request' && target !== 'response') {
    return {
      diagnostics: [
        diagnostic(
          'json-schema.target_invalid',
          'metadata.target must be "request" or "response".',
        ),
      ],
    };
  }
  return {
    value: {
      urlPattern,
      urlPatternKind,
      method: method.toUpperCase(),
      target,
    },
    diagnostics: [],
  };
}

function detectDialect(schema: AnySchema): {
  value?: JsonSchemaDialect;
  diagnostics: ReturnType<typeof diagnostic>[];
} {
  const declaration = typeof schema === 'boolean' ? undefined : schema.$schema;
  if (declaration === undefined) {
    return {
      value: 'draft-07',
      diagnostics: [
        diagnostic(
          'json-schema.dialect_defaulted',
          'No $schema was declared; draft-07 was selected.',
          { severity: 'warning' },
        ),
      ],
    };
  }
  if (typeof declaration !== 'string') {
    return {
      diagnostics: [
        diagnostic(
          'json-schema.dialect_invalid',
          '$schema must be a string URI.',
        ),
      ],
    };
  }
  if (/draft-0?7/i.test(declaration))
    return { value: 'draft-07', diagnostics: [] };
  if (/2019-09/i.test(declaration))
    return { value: '2019-09', diagnostics: [] };
  if (/2020-12/i.test(declaration))
    return { value: '2020-12', diagnostics: [] };
  return {
    diagnostics: [
      diagnostic(
        'json-schema.dialect_unsupported',
        `Unsupported JSON Schema dialect "${declaration}".`,
      ),
    ],
  };
}

function ajvFor(dialect: JsonSchemaDialect): Ajv | Ajv2019 | Ajv2020 {
  const options = {
    allErrors: true,
    strict: false,
    validateFormats: false,
  } as const;
  if (dialect === '2020-12') return new Ajv2020(options);
  if (dialect === '2019-09') return new Ajv2019(options);
  return new Ajv(options);
}

function validationDiagnostic(
  error: ErrorObject,
  contract: ContractDocument<JsonSchemaContract>,
) {
  return diagnostic(
    `json-schema.${error.keyword}`,
    error.message ?? 'JSON Schema validation failed.',
    {
      phase: contract.compiled.target,
      path: error.instancePath || '/',
    },
  );
}

function isSchemaObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isSchemaDocument(value: unknown): value is AnySchema {
  return typeof value === 'boolean' || isSchemaObject(value);
}

function findRemoteReference(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findRemoteReference(item);
      if (found) return found;
    }
  } else if (isSchemaObject(value)) {
    if (typeof value.$ref === 'string' && /^https?:\/\//i.test(value.$ref))
      return value.$ref;
    for (const item of Object.values(value)) {
      const found = findRemoteReference(item);
      if (found) return found;
    }
  }
  return undefined;
}

function depthOf(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): number {
  if (!value || typeof value !== 'object') return depth;
  if (seen.has(value)) return Number.POSITIVE_INFINITY;
  seen.add(value);
  const values = Array.isArray(value) ? value : Object.values(value);
  const maximum = values.reduce(
    (current, item) => Math.max(current, depthOf(item, depth + 1, seen)),
    depth,
  );
  seen.delete(value);
  return maximum;
}

export type JsonSchemaDocument = ContractDocument<JsonSchemaContract>;
export type JsonSchemaPlugin = ReturnType<typeof createJsonSchemaPlugin>;
export type JsonSchemaExchange = ExchangeSummary | LocalExchange;
