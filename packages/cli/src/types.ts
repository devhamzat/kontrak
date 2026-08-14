import type {
  ContractDocument,
  ContractValidationResult,
  LocalExchange,
} from '@kontrak/core';

export interface ContractConfig {
  readonly id: string;
  readonly name: string;
  readonly format: 'json-schema' | 'openapi';
  readonly path: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface KontrakConfig {
  readonly version: 1;
  readonly contracts: readonly ContractConfig[];
}

export interface LoadedContracts {
  readonly contracts: readonly ContractDocument[];
  readonly diagnostics: readonly import('@kontrak/core').Diagnostic[];
}

export interface ExchangeValidation {
  readonly exchange: LocalExchange;
  readonly result: ContractValidationResult;
}

export interface CliIo {
  readonly cwd: string;
  readFile(path: string): Promise<string>;
  stdout(value: string): void;
  stderr(value: string): void;
  env?: Readonly<Record<string, string | undefined>>;
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
}

export const ExitCode = {
  Success: 0,
  Violation: 1,
  UsageOrSystemError: 2,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];
