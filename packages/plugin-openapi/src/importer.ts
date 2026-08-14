import type { AnySchema } from 'ajv';
import { diagnostic, type ContractInput } from '@kontrak/plugin-sdk';
import { parse } from 'yaml';
import { findRemoteReference, isRecord, resolveObject } from './refs';
import type {
  OpenApiContract,
  OpenApiMediaType,
  OpenApiOperation,
  OpenApiParameter,
  OpenApiRequestBody,
  OpenApiResponse,
  OpenApiVersion,
} from './types';

const HTTP_METHODS = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options',
  'trace',
] as const;
const MAX_SOURCE_LENGTH = 2_000_000;

export function importOpenApi(input: ContractInput): {
  contract?: OpenApiContract;
  diagnostics: ReturnType<typeof diagnostic>[];
} {
  if (
    typeof input.content === 'string' &&
    input.content.length > MAX_SOURCE_LENGTH
  ) {
    return {
      diagnostics: [
        diagnostic(
          'openapi.source_too_large',
          `OpenAPI source exceeds the ${MAX_SOURCE_LENGTH} character limit.`,
          source(input),
        ),
      ],
    };
  }

  let document: unknown;
  try {
    document =
      typeof input.content === 'string' ? parse(input.content) : input.content;
  } catch (error) {
    return {
      diagnostics: [
        diagnostic(
          'openapi.parse_failed',
          error instanceof Error ? error.message : String(error),
          source(input),
        ),
      ],
    };
  }
  if (!isRecord(document)) {
    return {
      diagnostics: [
        diagnostic(
          'openapi.invalid_document',
          'An OpenAPI document must be an object.',
          source(input),
        ),
      ],
    };
  }

  const version = parseVersion(document.openapi);
  if (!version) {
    return {
      diagnostics: [
        diagnostic(
          'openapi.version_unsupported',
          `Expected OpenAPI 3.0.x or 3.1.x; received "${String(document.openapi)}".`,
          source(input, '/openapi'),
        ),
      ],
    };
  }
  const remoteReference = findRemoteReference(document);
  if (remoteReference) {
    return {
      diagnostics: [
        diagnostic(
          'openapi.remote_ref_disabled',
          `Remote reference "${remoteReference}" is disabled by default.`,
          source(input),
        ),
      ],
    };
  }
  if (!isRecord(document.paths)) {
    return {
      diagnostics: [
        diagnostic(
          'openapi.paths_required',
          'The document must contain a paths object.',
          source(input, '/paths'),
        ),
      ],
    };
  }

  try {
    const operations = compileOperations(document);
    if (operations.length === 0) {
      return {
        diagnostics: [
          diagnostic(
            'openapi.operations_required',
            'The document does not contain any supported HTTP operations.',
            source(input, '/paths'),
          ),
        ],
      };
    }
    return {
      contract: { document, version, operations, sourceUri: input.uri },
      diagnostics: duplicateOperationDiagnostics(operations, input),
    };
  } catch (error) {
    return {
      diagnostics: [
        diagnostic(
          'openapi.compile_failed',
          error instanceof Error ? error.message : String(error),
          source(input),
        ),
      ],
    };
  }
}

function compileOperations(
  document: Record<string, unknown>,
): OpenApiOperation[] {
  const paths = document.paths as Record<string, unknown>;
  const operations: OpenApiOperation[] = [];
  for (const [pathTemplate, rawPathItem] of Object.entries(paths)) {
    const pathItem = resolveObject(document, rawPathItem);
    if (!pathItem)
      throw new Error(`Path item "${pathTemplate}" must be an object.`);
    const pathParameters = compileParameters(
      document,
      pathItem.parameters,
      `/paths/${pointer(pathTemplate)}/parameters`,
    );

    for (const method of HTTP_METHODS) {
      if (pathItem[method] === undefined) continue;
      const operation = resolveObject(document, pathItem[method]);
      if (!operation)
        throw new Error(
          `${method.toUpperCase()} ${pathTemplate} must be an object.`,
        );
      const sourcePath = `/paths/${pointer(pathTemplate)}/${method}`;
      const ownParameters = compileParameters(
        document,
        operation.parameters,
        `${sourcePath}/parameters`,
      );
      const parameters = mergeParameters(pathParameters, ownParameters);
      const path = compilePathTemplate(pathTemplate);
      const operationId =
        typeof operation.operationId === 'string'
          ? operation.operationId
          : `${method.toUpperCase()} ${pathTemplate}`;
      operations.push({
        key: `${method}:${pathTemplate}`,
        method: method.toUpperCase(),
        pathTemplate,
        pathRegex: path.regex,
        pathParameterNames: path.names,
        operationId,
        parameters,
        requestBody: compileRequestBody(
          document,
          operation.requestBody,
          `${sourcePath}/requestBody`,
        ),
        responses: compileResponses(
          document,
          operation.responses,
          `${sourcePath}/responses`,
        ),
        score: 200 + path.staticLength - path.names.length,
      });
    }
  }
  return operations;
}

function compileParameters(
  document: Record<string, unknown>,
  raw: unknown,
  sourcePath: string,
): OpenApiParameter[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error(`${sourcePath} must be an array.`);
  return raw.map((entry, index) => {
    const parameter = resolveObject(document, entry);
    if (!parameter)
      throw new Error(`${sourcePath}/${index} must be a parameter object.`);
    const location = parameter.in;
    if (!['path', 'query', 'header', 'cookie'].includes(String(location))) {
      throw new Error(
        `${sourcePath}/${index}/in has unsupported value "${String(location)}".`,
      );
    }
    if (typeof parameter.name !== 'string') {
      throw new Error(`${sourcePath}/${index}/name must be a string.`);
    }
    const schema = parameter.schema;
    if (
      schema !== undefined &&
      typeof schema !== 'boolean' &&
      !isRecord(schema)
    ) {
      throw new Error(`${sourcePath}/${index}/schema must be a schema.`);
    }
    return {
      name: parameter.name,
      location: location as OpenApiParameter['location'],
      required: location === 'path' || parameter.required === true,
      ...(schema !== undefined ? { schema: schema as AnySchema } : {}),
      sourcePath: `${sourcePath}/${index}`,
    };
  });
}

function mergeParameters(
  inherited: readonly OpenApiParameter[],
  own: readonly OpenApiParameter[],
): OpenApiParameter[] {
  const merged = new Map(
    inherited.map((parameter) => [
      `${parameter.location}:${parameter.name}`,
      parameter,
    ]),
  );
  for (const parameter of own)
    merged.set(`${parameter.location}:${parameter.name}`, parameter);
  return [...merged.values()];
}

function compileRequestBody(
  document: Record<string, unknown>,
  raw: unknown,
  sourcePath: string,
): OpenApiRequestBody | undefined {
  if (raw === undefined) return undefined;
  const body = resolveObject(document, raw);
  if (!body) throw new Error(`${sourcePath} must be a request body object.`);
  return {
    required: body.required === true,
    content: compileContent(body.content, `${sourcePath}/content`),
    sourcePath,
  };
}

function compileResponses(
  document: Record<string, unknown>,
  raw: unknown,
  sourcePath: string,
): Record<string, OpenApiResponse> {
  if (!isRecord(raw)) throw new Error(`${sourcePath} must be an object.`);
  return Object.fromEntries(
    Object.entries(raw).map(([status, entry]) => {
      const response = resolveObject(document, entry);
      if (!response)
        throw new Error(`${sourcePath}/${status} must be a response object.`);
      return [
        status.toUpperCase(),
        {
          content: compileContent(
            response.content,
            `${sourcePath}/${pointer(status)}/content`,
          ),
          sourcePath: `${sourcePath}/${pointer(status)}`,
        },
      ];
    }),
  );
}

function compileContent(
  raw: unknown,
  sourcePath: string,
): Record<string, OpenApiMediaType> {
  if (raw === undefined) return {};
  if (!isRecord(raw)) throw new Error(`${sourcePath} must be an object.`);
  return Object.fromEntries(
    Object.entries(raw).map(([mediaType, entry]) => {
      if (!isRecord(entry))
        throw new Error(
          `${sourcePath}/${pointer(mediaType)} must be an object.`,
        );
      const schema = entry.schema;
      if (
        schema !== undefined &&
        typeof schema !== 'boolean' &&
        !isRecord(schema)
      ) {
        throw new Error(
          `${sourcePath}/${pointer(mediaType)}/schema must be a schema.`,
        );
      }
      return [
        mediaType.toLowerCase(),
        {
          ...(schema !== undefined ? { schema: schema as AnySchema } : {}),
          sourcePath: `${sourcePath}/${pointer(mediaType)}`,
        },
      ];
    }),
  );
}

function compilePathTemplate(template: string): {
  regex: RegExp;
  names: string[];
  staticLength: number;
} {
  const names: string[] = [];
  let staticLength = 0;
  let cursor = 0;
  let pattern = '^';
  for (const match of template.matchAll(/\{([^{}]+)\}/g)) {
    const index = match.index ?? 0;
    const literal = template.slice(cursor, index);
    pattern += escapeRegex(literal);
    staticLength += literal.length;
    names.push(match[1]);
    pattern += '([^/]+)';
    cursor = index + match[0].length;
  }
  const tail = template.slice(cursor);
  pattern += `${escapeRegex(tail)}/?$`;
  staticLength += tail.length;
  return { regex: new RegExp(pattern), names, staticLength };
}

function duplicateOperationDiagnostics(
  operations: readonly OpenApiOperation[],
  input: ContractInput,
): ReturnType<typeof diagnostic>[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const operation of operations) {
    if (seen.has(operation.operationId)) duplicates.add(operation.operationId);
    seen.add(operation.operationId);
  }
  return [...duplicates].map((operationId) =>
    diagnostic(
      'openapi.operation_id_duplicate',
      `operationId "${operationId}" is duplicated.`,
      {
        severity: 'warning',
        ...source(input),
      },
    ),
  );
}

function parseVersion(value: unknown): OpenApiVersion | undefined {
  if (typeof value !== 'string') return undefined;
  if (/^3\.0\.\d+(?:-|$)/.test(value)) return '3.0';
  if (/^3\.1\.\d+(?:-|$)/.test(value)) return '3.1';
  return undefined;
}

function source(input: ContractInput, pointerValue?: string) {
  return {
    ...(input.uri || pointerValue
      ? {
          source: {
            ...(input.uri ? { uri: input.uri } : {}),
            ...(pointerValue ? { pointer: pointerValue } : {}),
          },
        }
      : {}),
  };
}

function pointer(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
