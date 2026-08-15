import type {
  ContractAdapter,
  ContractDocument,
  Diagnostic,
  LocalExchange,
} from '@kontrak/core';

export const PLUGIN_API_VERSION = 1 as const;

export interface PluginManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly apiVersion: typeof PLUGIN_API_VERSION;
  readonly formats: readonly string[];
}

export interface ContractInput {
  readonly id: string;
  readonly name: string;
  readonly content: unknown;
  readonly uri?: string;
  readonly mediaType?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ImportContext {
  readonly signal?: AbortSignal;
}

export interface ImportResult<TCompiled = unknown> {
  readonly contracts: readonly ContractDocument<TCompiled>[];
  readonly diagnostics: readonly Diagnostic[];
}

export interface ContractChange {
  readonly code: string;
  readonly message: string;
  readonly severity: 'breaking' | 'non-breaking' | 'info';
  readonly pointer?: string;
}

export interface ContractPlugin<
  TCompiled = unknown,
> extends ContractAdapter<TCompiled> {
  readonly manifest: PluginManifest;
  canImport(input: ContractInput): Promise<number> | number;
  import(
    input: ContractInput,
    context?: ImportContext,
  ): Promise<ImportResult<TCompiled>> | ImportResult<TCompiled>;
  diff?(
    previous: ContractDocument<TCompiled>,
    next: ContractDocument<TCompiled>,
  ): Promise<readonly ContractChange[]> | readonly ContractChange[];
}

export function definePlugin<TCompiled>(
  plugin: ContractPlugin<TCompiled>,
): ContractPlugin<TCompiled> {
  if (plugin.manifest.apiVersion !== PLUGIN_API_VERSION) {
    throw new Error(
      `Plugin "${plugin.manifest.id}" targets API ${plugin.manifest.apiVersion}; expected ${PLUGIN_API_VERSION}.`,
    );
  }
  if (!plugin.manifest.formats.includes(plugin.format)) {
    throw new Error(
      `Plugin "${plugin.manifest.id}" does not declare its adapter format "${plugin.format}".`,
    );
  }
  return plugin;
}

export function diagnostic(
  code: string,
  message: string,
  options: Partial<Omit<Diagnostic, 'code' | 'message'>> = {},
): Diagnostic {
  return {
    code,
    message,
    severity: options.severity ?? 'error',
    phase: options.phase ?? 'import',
    ...(options.path ? { path: options.path } : {}),
    ...(options.source ? { source: options.source } : {}),
  };
}

export function bodyValue(
  exchange: LocalExchange,
  target: 'request' | 'response',
): { available: true; value: unknown } | { available: false; reason: string } {
  const body = exchange[target].body;
  switch (body.kind) {
    case 'json':
    case 'text':
      return { available: true, value: body.value };
    case 'empty':
      return { available: true, value: undefined };
    case 'binary':
      return {
        available: false,
        reason: 'Binary bodies are not supported by this validator.',
      };
    case 'unavailable':
      return { available: false, reason: body.reason };
  }
}
