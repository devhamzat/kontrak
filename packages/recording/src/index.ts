import type { HeaderMap, LocalExchange } from '@kontrak/core';

export const RECORDING_FORMAT = 'kontrak-recording' as const;
export const RECORDING_VERSION = 1 as const;

export interface RecordingRedaction {
  readonly removedHeaders: readonly string[];
  readonly redactedJsonKeys: readonly string[];
  readonly replacement: string;
}

export interface KontrakRecording {
  readonly format: typeof RECORDING_FORMAT;
  readonly version: typeof RECORDING_VERSION;
  readonly createdAt: string;
  readonly redaction?: RecordingRedaction;
  readonly exchanges: readonly LocalExchange[];
}

export interface RedactionOptions {
  readonly headerNames?: readonly string[];
  readonly jsonKeys?: readonly string[];
  readonly replacement?: string;
}

const DEFAULT_HEADERS = [
  'authorization',
  'cookie',
  'proxy-authorization',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
] as const;

export function createRecording(
  exchanges: readonly LocalExchange[],
  options: RedactionOptions = {},
): KontrakRecording {
  const headerNames = (options.headerNames ?? DEFAULT_HEADERS).map((name) =>
    name.toLowerCase(),
  );
  const jsonKeys = options.jsonKeys ?? [];
  const replacement = options.replacement ?? '[REDACTED]';
  return {
    format: RECORDING_FORMAT,
    version: RECORDING_VERSION,
    createdAt: new Date().toISOString(),
    redaction: {
      removedHeaders: headerNames,
      redactedJsonKeys: jsonKeys,
      replacement,
    },
    exchanges: exchanges.map((exchange) =>
      redactExchange(exchange, { headerNames, jsonKeys, replacement }),
    ),
  };
}

export function parseRecording(value: unknown): KontrakRecording {
  if (!isRecord(value)) throw new Error('Recording must be a JSON object.');
  if (value.format !== RECORDING_FORMAT) {
    throw new Error(`Unsupported recording format "${String(value.format)}".`);
  }
  if (value.version !== RECORDING_VERSION) {
    throw new Error(
      `Unsupported recording version "${String(value.version)}".`,
    );
  }
  if (typeof value.createdAt !== 'string')
    throw new Error('Recording createdAt must be a string.');
  if (!Array.isArray(value.exchanges))
    throw new Error('Recording exchanges must be an array.');
  value.exchanges.forEach((exchange, index) => assertExchange(exchange, index));
  return value as unknown as KontrakRecording;
}

function redactExchange(
  exchange: LocalExchange,
  options: Required<
    Pick<RedactionOptions, 'headerNames' | 'jsonKeys' | 'replacement'>
  >,
): LocalExchange {
  const hidden = new Set(options.headerNames.map((name) => name.toLowerCase()));
  return {
    ...exchange,
    request: {
      ...exchange.request,
      headers: redactHeaders(exchange.request.headers, hidden),
      body: redactBody(exchange.request.body, options),
    },
    response: {
      ...exchange.response,
      headers: redactHeaders(exchange.response.headers, hidden),
      body: redactBody(exchange.response.body, options),
    },
  };
}

function redactHeaders(
  headers: HeaderMap,
  hidden: ReadonlySet<string>,
): HeaderMap {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !hidden.has(name.toLowerCase())),
  );
}

function redactBody(
  body: LocalExchange['request']['body'],
  options: Required<Pick<RedactionOptions, 'jsonKeys' | 'replacement'>>,
): LocalExchange['request']['body'] {
  if (body.kind !== 'json' || options.jsonKeys.length === 0) return body;
  const keys = new Set(options.jsonKeys.map((key) => key.toLowerCase()));
  return {
    kind: 'json',
    value: redactJson(body.value, keys, options.replacement),
  };
}

function redactJson(
  value: unknown,
  keys: ReadonlySet<string>,
  replacement: string,
): unknown {
  if (Array.isArray(value))
    return value.map((item) => redactJson(item, keys, replacement));
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      keys.has(key.toLowerCase())
        ? replacement
        : redactJson(child, keys, replacement),
    ]),
  );
}

function assertExchange(
  value: unknown,
  index: number,
): asserts value is LocalExchange {
  if (!isRecord(value)) throw new Error(`Exchange ${index} must be an object.`);
  if (typeof value.id !== 'string' || typeof value.sessionId !== 'string') {
    throw new Error(
      `Exchange ${index} must contain string id and sessionId fields.`,
    );
  }
  if (typeof value.timestamp !== 'number')
    throw new Error(`Exchange ${index} timestamp is invalid.`);
  assertRequest(value.request, index);
  assertResponse(value.response, index);
}

function assertRequest(value: unknown, index: number): void {
  if (!isRecord(value))
    throw new Error(`Exchange ${index} request must be an object.`);
  if (typeof value.method !== 'string' || typeof value.url !== 'string') {
    throw new Error(`Exchange ${index} request method/url is invalid.`);
  }
  assertBody(value.body, `Exchange ${index} request`);
}

function assertResponse(value: unknown, index: number): void {
  if (!isRecord(value))
    throw new Error(`Exchange ${index} response must be an object.`);
  if (typeof value.status !== 'number')
    throw new Error(`Exchange ${index} response status is invalid.`);
  assertBody(value.body, `Exchange ${index} response`);
}

function assertBody(value: unknown, label: string): void {
  if (
    !isRecord(value) ||
    !['empty', 'json', 'text', 'binary', 'unavailable'].includes(
      String(value.kind),
    )
  ) {
    throw new Error(`${label} body is invalid.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
