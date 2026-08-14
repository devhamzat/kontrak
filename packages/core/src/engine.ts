import type {
  ContractAdapter,
  ContractDocument,
  ContractValidationResult,
  Diagnostic,
  LocalExchange,
  MatchResult,
} from './types';

interface Candidate {
  readonly adapter: ContractAdapter;
  readonly contract: ContractDocument;
  readonly match: MatchResult;
}

export interface ValidationEngineOptions {
  readonly pluginTimeoutMs?: number;
}

class PluginExecutionError extends Error {
  constructor(
    readonly reason: 'timeout' | 'cancelled',
    message: string,
  ) {
    super(message);
  }
}

function systemDiagnostic(code: string, message: string): Diagnostic {
  return { code, message, severity: 'error', phase: 'system' };
}

export class ValidationEngine {
  private readonly adapters = new Map<string, ContractAdapter>();
  private readonly pluginTimeoutMs: number;

  constructor(
    adapters: readonly ContractAdapter[] = [],
    options: ValidationEngineOptions = {},
  ) {
    this.pluginTimeoutMs = options.pluginTimeoutMs ?? 5_000;
    if (!Number.isFinite(this.pluginTimeoutMs) || this.pluginTimeoutMs <= 0) {
      throw new Error('pluginTimeoutMs must be a positive finite number.');
    }
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter: ContractAdapter): void {
    if (this.adapters.has(adapter.format)) {
      throw new Error(
        `A contract adapter for "${adapter.format}" is already registered.`,
      );
    }
    this.adapters.set(adapter.format, adapter);
  }

  async validate(
    exchange: LocalExchange,
    contracts: readonly ContractDocument[],
    signal?: AbortSignal,
  ): Promise<ContractValidationResult> {
    const candidates: Candidate[] = [];
    const diagnostics: Diagnostic[] = [];

    for (const contract of contracts) {
      const adapter = this.adapters.get(contract.format);
      if (!adapter) {
        diagnostics.push(
          systemDiagnostic(
            'core.adapter_missing',
            `No adapter is registered for contract format "${contract.format}".`,
          ),
        );
        continue;
      }

      try {
        const match = await controlledExecution(
          () => adapter.match(exchange, contract),
          signal,
          this.pluginTimeoutMs,
        );
        diagnostics.push(...match.diagnostics);
        if (match.matched) candidates.push({ adapter, contract, match });
      } catch (error) {
        diagnostics.push(executionDiagnostic('match', contract.name, error));
      }
    }

    if (candidates.length === 0) {
      return {
        exchangeId: exchange.id,
        status: diagnostics.some((item) => item.severity === 'error')
          ? 'error'
          : 'skipped',
        diagnostics,
      };
    }

    candidates.sort(
      (left, right) =>
        right.match.score - left.match.score ||
        left.contract.id.localeCompare(right.contract.id),
    );
    const selected = candidates[0];
    const tied = candidates.filter(
      (candidate) => candidate.match.score === selected.match.score,
    );

    if (tied.length > 1) {
      return {
        exchangeId: exchange.id,
        status: 'error',
        diagnostics: [
          ...diagnostics,
          {
            code: 'core.match_ambiguous',
            message: `Multiple contracts matched with score ${selected.match.score}: ${tied
              .map((candidate) => candidate.contract.name)
              .join(', ')}.`,
            severity: 'error',
            phase: 'match',
          },
        ],
      };
    }

    try {
      const result = await controlledExecution(
        () =>
          selected.adapter.validate(
            exchange,
            selected.contract,
            selected.match,
            signal,
          ),
        signal,
        this.pluginTimeoutMs,
      );
      return {
        ...result,
        diagnostics: [...diagnostics, ...result.diagnostics],
      };
    } catch (error) {
      return {
        exchangeId: exchange.id,
        contractId: selected.contract.id,
        format: selected.contract.format,
        operationId: selected.match.operationId,
        status: 'error',
        diagnostics: [
          ...diagnostics,
          executionDiagnostic('validation', selected.contract.name, error),
        ],
      };
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function executionDiagnostic(
  phase: 'match' | 'validation',
  contractName: string,
  error: unknown,
): Diagnostic {
  const suffix =
    error instanceof PluginExecutionError ? error.reason : 'failed';
  return systemDiagnostic(
    `core.${phase}_${suffix}`,
    `Contract "${contractName}" ${phase} ${suffix}: ${errorMessage(error)}`,
  );
}

async function controlledExecution<T>(
  operation: () => Promise<T> | T,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<T> {
  if (signal?.aborted) {
    throw new PluginExecutionError('cancelled', 'Execution was cancelled.');
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () =>
        reject(new PluginExecutionError('timeout', `Exceeded ${timeoutMs}ms.`)),
      timeoutMs,
    );
  });
  const cancellation = new Promise<never>((_, reject) => {
    if (!signal) return;
    abortListener = () =>
      reject(new PluginExecutionError('cancelled', 'Execution was cancelled.'));
    signal.addEventListener('abort', abortListener, { once: true });
  });

  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      timeout,
      cancellation,
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (signal && abortListener)
      signal.removeEventListener('abort', abortListener);
  }
}
