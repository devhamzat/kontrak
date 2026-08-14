import type {
  ContractDocument,
  ContractValidationResult,
  Diagnostic,
  ExchangeBody,
  LocalExchange,
  MatchResult,
  ValidationPhase,
} from '@kontrak/core';
import {
  PLUGIN_API_VERSION,
  bodyValue,
  definePlugin,
  diagnostic,
  type ContractPlugin,
  type ContractChange,
} from '@kontrak/plugin-sdk';
import Ajv, {
  type AnySchema,
  type ErrorObject,
  type ValidateFunction,
} from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import { parse } from 'yaml';
import { importOpenApi } from './importer';
import { bundleSchema } from './schema';
import type {
  OpenApiContract,
  OpenApiMediaType,
  OpenApiOperation,
  OpenApiParameter,
  OpenApiResponse,
} from './types';

export const OPENAPI_FORMAT = 'openapi' as const;

export function createOpenApiPlugin(): ContractPlugin<OpenApiContract> {
  const validatorCache = new WeakMap<
    OpenApiContract,
    Map<string, ValidateFunction>
  >();

  return definePlugin<OpenApiContract>({
    format: OPENAPI_FORMAT,
    manifest: {
      id: '@kontrak/plugin-openapi',
      name: 'Kontrak OpenAPI',
      version: '0.1.0',
      apiVersion: PLUGIN_API_VERSION,
      formats: [OPENAPI_FORMAT],
    },

    canImport(input) {
      if (isOpenApiDocument(input.content)) return 1;
      if (typeof input.content !== 'string') return 0;
      try {
        return isOpenApiDocument(parse(input.content)) ? 0.95 : 0;
      } catch {
        return 0;
      }
    },

    import(input) {
      const imported = importOpenApi(input);
      return {
        contracts: imported.contract
          ? [
              {
                id: input.id,
                name: input.name,
                format: OPENAPI_FORMAT,
                formatVersion: imported.contract.version,
                compiled: imported.contract,
              },
            ]
          : [],
        diagnostics: imported.diagnostics,
      };
    },

    match(exchange, contract): MatchResult {
      const pathname = requestPath(exchange.request.url);
      const candidates = contract.compiled.operations
        .filter(
          (operation) =>
            operation.method === exchange.request.method.toUpperCase() &&
            operation.pathRegex.test(pathname),
        )
        .sort(
          (left, right) =>
            right.score - left.score ||
            left.operationId.localeCompare(right.operationId),
        );
      if (candidates.length === 0)
        return { matched: false, score: 0, diagnostics: [] };
      const selected = candidates[0];
      const tied = candidates.filter(
        (candidate) => candidate.score === selected.score,
      );
      if (tied.length > 1) {
        return {
          matched: false,
          score: 0,
          diagnostics: [
            contractDiagnostic(
              contract,
              'openapi.operation_ambiguous',
              `Multiple operations match ${exchange.request.method} ${pathname}: ${tied
                .map((operation) => operation.operationId)
                .join(', ')}.`,
              'match',
            ),
          ],
        };
      }
      return {
        matched: true,
        score: selected.score,
        operationId: selected.operationId,
        diagnostics: [],
      };
    },

    validate(exchange, contract, match): ContractValidationResult {
      const operation = contract.compiled.operations.find(
        (candidate) => candidate.operationId === match.operationId,
      );
      if (!match.matched || !operation) {
        return {
          exchangeId: exchange.id,
          contractId: contract.id,
          format: contract.format,
          status: 'skipped',
          diagnostics: [],
        };
      }

      const diagnostics: Diagnostic[] = [];
      validateParameters(
        exchange,
        contract,
        operation,
        diagnostics,
        validatorCache,
      );
      validateRequestBody(
        exchange,
        contract,
        operation,
        diagnostics,
        validatorCache,
      );
      validateResponse(
        exchange,
        contract,
        operation,
        diagnostics,
        validatorCache,
      );
      return {
        exchangeId: exchange.id,
        contractId: contract.id,
        format: contract.format,
        operationId: operation.operationId,
        status: diagnostics.some((item) => item.severity === 'error')
          ? 'invalid'
          : 'valid',
        diagnostics,
      };
    },

    diff(previous, next) {
      return diffOpenApi(previous.compiled, next.compiled);
    },
  });
}

function diffOpenApi(
  previous: OpenApiContract,
  next: OpenApiContract,
): ContractChange[] {
  const changes: ContractChange[] = [];
  const nextOperations = new Map(
    next.operations.map((operation) => [operation.key, operation]),
  );
  for (const oldOperation of previous.operations) {
    const newOperation = nextOperations.get(oldOperation.key);
    if (!newOperation) {
      changes.push({
        code: 'openapi.operation_removed',
        message: `${oldOperation.method} ${oldOperation.pathTemplate} was removed.`,
        severity: 'breaking',
        pointer: `/paths/${escapePointer(oldOperation.pathTemplate)}/${oldOperation.method.toLowerCase()}`,
      });
      continue;
    }
    for (const status of Object.keys(oldOperation.responses)) {
      if (!(status in newOperation.responses)) {
        changes.push({
          code: 'openapi.response_removed',
          message: `Response ${status} was removed from ${oldOperation.operationId}.`,
          severity: 'breaking',
          pointer: oldOperation.responses[status]?.sourcePath,
        });
      }
    }
    const oldRequired = new Set(
      oldOperation.parameters
        .filter((parameter) => parameter.required)
        .map((parameter) => `${parameter.location}:${parameter.name}`),
    );
    for (const parameter of newOperation.parameters.filter(
      (item) => item.required,
    )) {
      const key = `${parameter.location}:${parameter.name}`;
      if (!oldRequired.has(key)) {
        changes.push({
          code: 'openapi.required_parameter_added',
          message: `Required ${parameter.location} parameter "${parameter.name}" was added to ${newOperation.operationId}.`,
          severity: 'breaking',
          pointer: parameter.sourcePath,
        });
      }
    }
    if (
      !oldOperation.requestBody?.required &&
      newOperation.requestBody?.required
    ) {
      changes.push({
        code: 'openapi.request_body_required',
        message: `Request body became required for ${newOperation.operationId}.`,
        severity: 'breaking',
        pointer: newOperation.requestBody.sourcePath,
      });
    }
  }
  return changes;
}

function validateParameters(
  exchange: LocalExchange,
  contract: ContractDocument<OpenApiContract>,
  operation: OpenApiOperation,
  diagnostics: Diagnostic[],
  cache: WeakMap<OpenApiContract, Map<string, ValidateFunction>>,
): void {
  const pathValues = extractPathParameters(
    operation,
    requestPath(exchange.request.url),
  );
  const url = safeUrl(exchange.request.url);

  for (const parameter of operation.parameters) {
    const raw = parameterValue(parameter, exchange, url, pathValues);
    if (raw === undefined || raw === '') {
      if (parameter.required) {
        diagnostics.push(
          operationDiagnostic(
            contract,
            parameter.sourcePath,
            'openapi.parameter_required',
            `Required ${parameter.location} parameter "${parameter.name}" is missing.`,
            'request',
            `/${parameter.location}/${parameter.name}`,
          ),
        );
      }
      continue;
    }
    if (!parameter.schema) continue;
    validateValue(
      contract,
      `${operation.key}:parameter:${parameter.location}:${parameter.name}`,
      parameter.schema,
      coerceParameter(raw, parameter.schema),
      parameter.sourcePath,
      'request',
      `/${parameter.location}/${parameter.name}`,
      diagnostics,
      cache,
    );
  }
}

function validateRequestBody(
  exchange: LocalExchange,
  contract: ContractDocument<OpenApiContract>,
  operation: OpenApiOperation,
  diagnostics: Diagnostic[],
  cache: WeakMap<OpenApiContract, Map<string, ValidateFunction>>,
): void {
  const requestBody = operation.requestBody;
  if (!requestBody) return;
  if (exchange.request.body.kind === 'empty') {
    if (requestBody.required) {
      diagnostics.push(
        operationDiagnostic(
          contract,
          requestBody.sourcePath,
          'openapi.request_body_required',
          'A required request body is missing.',
          'request',
          '/body',
        ),
      );
    }
    return;
  }
  const selection = selectMediaType(
    requestBody.content,
    exchange.request.mediaType,
  );
  if (!selection) {
    if (Object.keys(requestBody.content).length > 0) {
      diagnostics.push(
        operationDiagnostic(
          contract,
          requestBody.sourcePath,
          'openapi.request_media_type_unsupported',
          `Request media type "${exchange.request.mediaType ?? 'unknown'}" is not documented.`,
          'request',
          '/body',
        ),
      );
    }
    return;
  }
  validateMediaBody(
    exchange.request.body,
    selection,
    contract,
    `${operation.key}:request:${selection.key}`,
    'request',
    diagnostics,
    cache,
  );
}

function validateResponse(
  exchange: LocalExchange,
  contract: ContractDocument<OpenApiContract>,
  operation: OpenApiOperation,
  diagnostics: Diagnostic[],
  cache: WeakMap<OpenApiContract, Map<string, ValidateFunction>>,
): void {
  const selected = selectResponse(
    operation.responses,
    exchange.response.status,
  );
  if (!selected) {
    diagnostics.push(
      operationDiagnostic(
        contract,
        `/paths/${operation.pathTemplate}/responses`,
        'openapi.response_undocumented',
        `Response status ${exchange.response.status} is not documented.`,
        'response',
        '/status',
      ),
    );
    return;
  }
  if (exchange.response.body.kind === 'empty') return;
  const media = selectMediaType(
    selected.response.content,
    exchange.response.mediaType,
  );
  if (!media) {
    if (Object.keys(selected.response.content).length > 0) {
      diagnostics.push(
        operationDiagnostic(
          contract,
          selected.response.sourcePath,
          'openapi.response_media_type_unsupported',
          `Response media type "${exchange.response.mediaType ?? 'unknown'}" is not documented.`,
          'response',
          '/body',
        ),
      );
    }
    return;
  }
  validateMediaBody(
    exchange.response.body,
    media,
    contract,
    `${operation.key}:response:${selected.key}:${media.key}`,
    'response',
    diagnostics,
    cache,
  );
}

function validateMediaBody(
  body: ExchangeBody,
  selection: { key: string; media: OpenApiMediaType },
  contract: ContractDocument<OpenApiContract>,
  cacheKey: string,
  phase: 'request' | 'response',
  diagnostics: Diagnostic[],
  cache: WeakMap<OpenApiContract, Map<string, ValidateFunction>>,
): void {
  if (!selection.media.schema) return;
  const value = bodyValue(
    {
      id: '',
      sessionId: '',
      timestamp: 0,
      request: { method: '', url: '', headers: {}, body },
      response: { status: 0, headers: {}, body },
    },
    phase,
  );
  if (!value.available) {
    diagnostics.push(
      operationDiagnostic(
        contract,
        selection.media.sourcePath,
        'openapi.body_unavailable',
        value.reason,
        phase,
        '/body',
      ),
    );
    return;
  }
  validateValue(
    contract,
    cacheKey,
    selection.media.schema,
    value.value,
    selection.media.sourcePath,
    phase,
    '/body',
    diagnostics,
    cache,
  );
}

function validateValue(
  contract: ContractDocument<OpenApiContract>,
  cacheKey: string,
  schema: AnySchema,
  value: unknown,
  sourcePath: string,
  phase: 'request' | 'response',
  instancePrefix: string,
  diagnostics: Diagnostic[],
  cache: WeakMap<OpenApiContract, Map<string, ValidateFunction>>,
): void {
  try {
    const validate = validatorFor(contract.compiled, cacheKey, schema, cache);
    if (validate(value)) return;
    diagnostics.push(
      ...(validate.errors ?? []).map((error) =>
        ajvDiagnostic(contract, sourcePath, phase, instancePrefix, error),
      ),
    );
  } catch (error) {
    diagnostics.push(
      operationDiagnostic(
        contract,
        sourcePath,
        'openapi.schema_invalid',
        error instanceof Error ? error.message : String(error),
        phase,
        instancePrefix,
      ),
    );
  }
}

function validatorFor(
  contract: OpenApiContract,
  key: string,
  schema: AnySchema,
  cache: WeakMap<OpenApiContract, Map<string, ValidateFunction>>,
): ValidateFunction {
  const validators = cache.get(contract) ?? new Map<string, ValidateFunction>();
  cache.set(contract, validators);
  const existing = validators.get(key);
  if (existing) return existing;
  const options = {
    allErrors: true,
    strict: false,
    validateFormats: false,
    coerceTypes: true,
  } as const;
  const ajv =
    contract.version === '3.1' ? new Ajv2020(options) : new Ajv(options);
  const validate = ajv.compile(
    bundleSchema(contract.document, schema, contract.version),
  );
  validators.set(key, validate);
  return validate;
}

function extractPathParameters(
  operation: OpenApiOperation,
  pathname: string,
): Map<string, string> {
  const match = operation.pathRegex.exec(pathname);
  const values = new Map<string, string>();
  if (!match) return values;
  operation.pathParameterNames.forEach((name, index) => {
    try {
      values.set(name, decodeURIComponent(match[index + 1]));
    } catch {
      values.set(name, match[index + 1]);
    }
  });
  return values;
}

function parameterValue(
  parameter: OpenApiParameter,
  exchange: LocalExchange,
  url: URL | undefined,
  pathValues: ReadonlyMap<string, string>,
): string | string[] | undefined {
  if (parameter.location === 'path') return pathValues.get(parameter.name);
  if (parameter.location === 'query') {
    const values = url?.searchParams.getAll(parameter.name) ?? [];
    return values.length > 1 ? values : values[0];
  }
  const header = Object.entries(exchange.request.headers).find(
    ([name]) => name.toLowerCase() === parameter.name.toLowerCase(),
  )?.[1];
  if (parameter.location === 'header') return header;
  if (!header && parameter.location === 'cookie') {
    const cookie = Object.entries(exchange.request.headers).find(
      ([name]) => name.toLowerCase() === 'cookie',
    )?.[1];
    return cookie
      ?.split(';')
      .map((part) => part.trim().split('='))
      .find(([name]) => name === parameter.name)?.[1];
  }
  return undefined;
}

function coerceParameter(value: string | string[], schema: AnySchema): unknown {
  if (typeof schema === 'boolean' || Array.isArray(value)) return value;
  if (schema.type === 'integer' || schema.type === 'number') {
    const number = Number(value);
    return Number.isNaN(number) ? value : number;
  }
  if (schema.type === 'boolean') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  if (schema.type === 'array') return String(value).split(',');
  return value;
}

function selectResponse(
  responses: Readonly<Record<string, OpenApiResponse>>,
  status: number,
): { key: string; response: OpenApiResponse } | undefined {
  const exact = String(status);
  const range = `${Math.floor(status / 100)}XX`;
  const key = responses[exact]
    ? exact
    : responses[range]
      ? range
      : responses.DEFAULT
        ? 'DEFAULT'
        : undefined;
  return key ? { key, response: responses[key] } : undefined;
}

function selectMediaType(
  content: Readonly<Record<string, OpenApiMediaType>>,
  actual: string | undefined,
): { key: string; media: OpenApiMediaType } | undefined {
  const entries = Object.entries(content);
  if (entries.length === 0) return undefined;
  if (!actual)
    return entries.length === 1
      ? { key: entries[0][0], media: entries[0][1] }
      : undefined;
  const normalized = actual.toLowerCase().split(';', 1)[0].trim();
  const exact = content[normalized];
  if (exact) return { key: normalized, media: exact };
  const [type] = normalized.split('/');
  const wildcard = `${type}/*`;
  if (content[wildcard]) return { key: wildcard, media: content[wildcard] };
  if (content['*/*']) return { key: '*/*', media: content['*/*'] };
  return undefined;
}

function ajvDiagnostic(
  contract: ContractDocument<OpenApiContract>,
  sourcePath: string,
  phase: 'request' | 'response',
  prefix: string,
  error: ErrorObject,
): Diagnostic {
  return operationDiagnostic(
    contract,
    sourcePath,
    `openapi.schema.${error.keyword}`,
    error.message ?? 'Schema validation failed.',
    phase,
    `${prefix}${error.instancePath || ''}`,
  );
}

function operationDiagnostic(
  contract: ContractDocument<OpenApiContract>,
  sourcePath: string,
  code: string,
  message: string,
  phase: 'request' | 'response',
  path: string,
): Diagnostic {
  return diagnostic(code, message, {
    phase,
    path,
    source: {
      ...(contract.compiled.sourceUri
        ? { uri: contract.compiled.sourceUri }
        : {}),
      pointer: sourcePath,
    },
  });
}

function contractDiagnostic(
  contract: ContractDocument<OpenApiContract>,
  code: string,
  message: string,
  phase: ValidationPhase,
): Diagnostic {
  return diagnostic(code, message, {
    phase,
    source: contract.compiled.sourceUri
      ? { uri: contract.compiled.sourceUri }
      : undefined,
  });
}

function isOpenApiDocument(value: unknown): value is Record<string, unknown> {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof (value as Record<string, unknown>).openapi === 'string',
  );
}

function safeUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function requestPath(value: string): string {
  return safeUrl(value)?.pathname ?? value.split('?', 1)[0];
}

function escapePointer(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

export type {
  OpenApiContract,
  OpenApiOperation,
  OpenApiVersion,
} from './types';
