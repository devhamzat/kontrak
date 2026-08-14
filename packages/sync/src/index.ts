import type {
  ContractValidationResult,
  Diagnostic,
  LocalExchange,
} from '@kontrak/core';

export const SYNC_PROTOCOL = 'kontrak-sync' as const;
export const SYNC_VERSION = 1 as const;

export interface SanitizedDiagnostic {
  readonly code: string;
  readonly severity: Diagnostic['severity'];
  readonly phase: Diagnostic['phase'];
  readonly path?: string;
  readonly source?: {
    readonly uri?: string;
    readonly line?: number;
    readonly column?: number;
    readonly pointer?: string;
  };
}

export interface SanitizedValidationReport {
  readonly protocol: typeof SYNC_PROTOCOL;
  readonly version: typeof SYNC_VERSION;
  readonly id: string;
  readonly projectId: string;
  readonly contractVersionId?: string;
  readonly occurredAt: string;
  readonly request: {
    readonly method: string;
    readonly origin: string;
    readonly pathname: string;
  };
  readonly response: {
    readonly status: number;
  };
  readonly validation: {
    readonly contractId?: string;
    readonly format?: string;
    readonly operationId?: string;
    readonly status: ContractValidationResult['status'];
    readonly diagnostics: readonly SanitizedDiagnostic[];
  };
}

export interface CreateReportInput {
  readonly projectId: string;
  readonly contractVersionId?: string;
  readonly exchange: LocalExchange;
  readonly result: ContractValidationResult;
}

export interface SyncTransport {
  sendReport(
    report: SanitizedValidationReport,
    signal?: AbortSignal,
  ): Promise<void>;
}

const FORBIDDEN_KEYS = new Set([
  'authorization',
  'body',
  'cookie',
  'headers',
  'password',
  'payload',
  'proxy-authorization',
  'secret',
  'set-cookie',
  'token',
  'x-api-key',
]);

export function createSanitizedReport(
  input: CreateReportInput,
): SanitizedValidationReport {
  const url = new URL(input.exchange.request.url);
  const report: SanitizedValidationReport = {
    protocol: SYNC_PROTOCOL,
    version: SYNC_VERSION,
    id: input.exchange.id,
    projectId: input.projectId,
    ...(input.contractVersionId
      ? { contractVersionId: input.contractVersionId }
      : {}),
    occurredAt: new Date(input.exchange.timestamp).toISOString(),
    request: {
      method: input.exchange.request.method,
      origin: url.origin,
      pathname: url.pathname,
    },
    response: { status: input.exchange.response.status },
    validation: {
      ...(input.result.contractId
        ? { contractId: input.result.contractId }
        : {}),
      ...(input.result.format ? { format: input.result.format } : {}),
      ...(input.result.operationId
        ? { operationId: input.result.operationId }
        : {}),
      status: input.result.status,
      diagnostics: input.result.diagnostics.map(sanitizeDiagnostic),
    },
  };
  assertCloudSafe(report);
  return report;
}

export class SyncClient {
  constructor(private readonly transport: SyncTransport) {}

  async send(
    report: SanitizedValidationReport,
    signal?: AbortSignal,
  ): Promise<void> {
    assertCloudSafe(report);
    await this.transport.sendReport(report, signal);
  }
}

export function assertCloudSafe(value: unknown): void {
  visit(value, '$', new Set<object>());
}

function sanitizeDiagnostic(diagnostic: Diagnostic): SanitizedDiagnostic {
  return {
    code: diagnostic.code,
    severity: diagnostic.severity,
    phase: diagnostic.phase,
    ...(diagnostic.path ? { path: diagnostic.path } : {}),
    ...(diagnostic.source ? { source: { ...diagnostic.source } } : {}),
  };
}

function visit(value: unknown, path: string, seen: Set<object>): void {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value))
    throw new Error(`Cloud sync value is cyclic at ${path}.`);
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => visit(item, `${path}[${index}]`, seen));
  } else {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
        throw new Error(`Cloud sync forbids sensitive field ${path}.${key}.`);
      }
      visit(child, `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
}
