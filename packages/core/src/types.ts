export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS'
  | (string & {});

export type HeaderMap = Readonly<Record<string, string>>;

export type ExchangeBody =
  | { readonly kind: 'empty' }
  | { readonly kind: 'json'; readonly value: unknown }
  | { readonly kind: 'text'; readonly value: string }
  | {
      readonly kind: 'binary';
      readonly byteLength: number;
      readonly encoding?: string;
    }
  | { readonly kind: 'unavailable'; readonly reason: string };

export interface ExchangeSummary {
  readonly id: string;
  readonly sessionId: string;
  readonly timestamp: number;
  readonly request: {
    readonly method: HttpMethod;
    readonly url: string;
    readonly mediaType?: string;
  };
  readonly response: {
    readonly status: number;
    readonly mediaType?: string;
  };
}

export interface LocalExchange extends ExchangeSummary {
  readonly request: ExchangeSummary['request'] & {
    readonly headers: HeaderMap;
    readonly body: ExchangeBody;
  };
  readonly response: ExchangeSummary['response'] & {
    readonly headers: HeaderMap;
    readonly body: ExchangeBody;
  };
}

export type DiagnosticSeverity = 'info' | 'warning' | 'error';
export type ValidationPhase =
  | 'import'
  | 'match'
  | 'request'
  | 'response'
  | 'system';

export interface Diagnostic {
  readonly code: string;
  readonly message: string;
  readonly severity: DiagnosticSeverity;
  readonly phase: ValidationPhase;
  readonly path?: string;
  readonly source?: {
    readonly uri?: string;
    readonly line?: number;
    readonly column?: number;
    readonly pointer?: string;
  };
}

export interface ContractDocument<TCompiled = unknown> {
  readonly id: string;
  readonly name: string;
  readonly format: string;
  readonly formatVersion?: string;
  readonly compiled: TCompiled;
}

export interface MatchResult {
  readonly matched: boolean;
  readonly score: number;
  readonly operationId?: string;
  readonly diagnostics: readonly Diagnostic[];
}

export type ValidationStatus = 'valid' | 'invalid' | 'skipped' | 'error';

export interface ContractValidationResult {
  readonly exchangeId: string;
  readonly contractId?: string;
  readonly format?: string;
  readonly operationId?: string;
  readonly status: ValidationStatus;
  readonly diagnostics: readonly Diagnostic[];
}

export interface ContractAdapter<TCompiled = unknown> {
  readonly format: string;
  match(
    exchange: ExchangeSummary,
    contract: ContractDocument<TCompiled>,
  ): Promise<MatchResult> | MatchResult;
  validate(
    exchange: LocalExchange,
    contract: ContractDocument<TCompiled>,
    match: MatchResult,
    signal?: AbortSignal,
  ): Promise<ContractValidationResult> | ContractValidationResult;
}
