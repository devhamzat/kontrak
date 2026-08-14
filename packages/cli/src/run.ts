import { ValidationEngine } from '@kontrak/core';
import { createJsonSchemaPlugin } from '@kontrak/plugin-json-schema';
import { createOpenApiPlugin } from '@kontrak/plugin-openapi';
import { parseRecording } from '@kontrak/recording';
import { createSanitizedReport, SyncClient } from '@kontrak/sync';
import path from 'node:path';
import { importContract, loadConfiguredContracts } from './config';
import { diffContractFiles, formatChanges, isBreaking } from './diff';
import {
  formatDiagnostics,
  formatValidation,
  type OutputFormat,
} from './output';
import { ExitCode, type CliIo, type ExitCodeValue } from './types';

export async function runCli(
  argv: readonly string[],
  io: CliIo,
): Promise<ExitCodeValue> {
  try {
    const [command, ...rest] = argv;
    if (
      !command ||
      command === 'help' ||
      command === '--help' ||
      command === '-h'
    ) {
      io.stdout(helpText());
      return ExitCode.Success;
    }
    const parsed = parseArguments(rest);
    if (command === 'validate') return await validateCommand(parsed, io);
    if (command === 'import') return await importCommand(parsed, io);
    if (command === 'diff') return await diffCommand(parsed, io);
    throw new Error(`Unknown command "${command}".\n\n${helpText()}`);
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return ExitCode.UsageOrSystemError;
  }
}

async function validateCommand(
  args: ParsedArguments,
  io: CliIo,
): Promise<ExitCodeValue> {
  const configPath = option(args, 'config') ?? 'kontrak.config.json';
  const recordingPath =
    option(args, 'recording') ?? args.positional[0] ?? 'kontrak.recording.json';
  const output = outputFormat(option(args, 'output') ?? 'human');
  const configured = await loadConfiguredContracts(io, configPath);
  const importErrors = configured.diagnostics.filter(
    (item) => item.severity === 'error',
  );
  if (configured.diagnostics.length > 0 && output === 'human') {
    io.stderr(formatDiagnostics(configured.diagnostics));
  }
  if (importErrors.length > 0 || configured.contracts.length === 0) {
    if (configured.contracts.length === 0)
      io.stderr('No contracts were imported.');
    return ExitCode.UsageOrSystemError;
  }

  const recording = parseRecording(
    JSON.parse(
      await io.readFile(path.resolve(io.cwd, recordingPath)),
    ) as unknown,
  );
  const engine = new ValidationEngine([
    createJsonSchemaPlugin(),
    createOpenApiPlugin(),
  ]);
  const validations = await Promise.all(
    recording.exchanges.map(async (exchange) => ({
      exchange,
      result: await engine.validate(exchange, configured.contracts),
    })),
  );
  io.stdout(formatValidation(validations, output));
  const sync = syncOptions(args, io);
  if (sync) {
    const sent = await syncValidations(validations, sync, io);
    io.stderr(
      `Synced ${sent} sanitized validation report${sent === 1 ? '' : 's'} to Kontrak Cloud.`,
    );
  }
  const failed = validations.some(
    ({ result }) =>
      result.status === 'invalid' ||
      result.status === 'error' ||
      (args.flags.has('fail-on-unmatched') && result.status === 'skipped'),
  );
  return failed ? ExitCode.Violation : ExitCode.Success;
}

interface SyncOptions {
  readonly baseUrl: string;
  readonly projectId: string;
  readonly apiKey: string;
}

function syncOptions(
  args: ParsedArguments,
  io: CliIo,
): SyncOptions | undefined {
  const baseUrl = option(args, 'sync-url') ?? io.env?.KONTRAK_SYNC_URL;
  const projectId = option(args, 'project') ?? io.env?.KONTRAK_PROJECT_ID;
  const apiKey = option(args, 'api-key') ?? io.env?.KONTRAK_API_KEY;
  if (!baseUrl && !projectId && !apiKey) return undefined;
  if (!baseUrl || !projectId || !apiKey)
    throw new Error(
      'Cloud sync requires --sync-url, --project, and KONTRAK_API_KEY (or --api-key).',
    );
  return { baseUrl: baseUrl.replace(/\/$/, ''), projectId, apiKey };
}

async function syncValidations(
  validations: readonly import('./types').ExchangeValidation[],
  options: SyncOptions,
  io: CliIo,
): Promise<number> {
  if (!io.fetch) throw new Error('Cloud sync is unavailable in this runtime.');
  const client = new SyncClient({
    sendReport: async (report, signal) => {
      const response = await io.fetch!(
        `${options.baseUrl}/api/v1/machine-reports`,
        {
          method: 'POST',
          signal,
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(report),
        },
      );
      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `Cloud sync failed (${response.status}): ${text.slice(0, 300)}`,
        );
      }
    },
  });
  for (const { exchange, result } of validations) {
    await client.send(
      createSanitizedReport({ projectId: options.projectId, exchange, result }),
    );
  }
  return validations.length;
}

async function importCommand(
  args: ParsedArguments,
  io: CliIo,
): Promise<ExitCodeValue> {
  const file = args.positional[0];
  if (!file)
    throw new Error(
      'Usage: kontrak import <contract-file> [--format openapi|json-schema]',
    );
  const absolute = path.resolve(io.cwd, file);
  const content = await io.readFile(absolute);
  const format = await detectFormat(content, option(args, 'format'));
  const imported = await importContract(
    {
      id: option(args, 'id') ?? path.basename(file),
      name: option(args, 'name') ?? path.basename(file),
      format,
      metadata:
        format === 'json-schema'
          ? {
              method: option(args, 'method') ?? 'ALL',
              target: option(args, 'target') ?? 'response',
              urlPattern: option(args, 'url') ?? '/',
              urlPatternKind: option(args, 'match') ?? 'literal',
            }
          : undefined,
    },
    content,
    absolute,
  );
  if (imported.diagnostics.length > 0)
    io.stderr(formatDiagnostics(imported.diagnostics));
  if (imported.contracts.length === 0) return ExitCode.UsageOrSystemError;
  const contract = imported.contracts[0];
  io.stdout(
    JSON.stringify(
      {
        id: contract.id,
        name: contract.name,
        format: contract.format,
        formatVersion: contract.formatVersion,
        ...(contract.format === 'openapi'
          ? {
              operations: (
                contract.compiled as { operations: readonly unknown[] }
              ).operations.length,
            }
          : {}),
      },
      null,
      2,
    ),
  );
  return ExitCode.Success;
}

async function diffCommand(
  args: ParsedArguments,
  io: CliIo,
): Promise<ExitCodeValue> {
  const [previous, next] = args.positional;
  if (!previous || !next) {
    throw new Error(
      'Usage: kontrak diff <previous> <next> --format openapi|json-schema',
    );
  }
  const previousContent = await io.readFile(path.resolve(io.cwd, previous));
  const format = await detectFormat(previousContent, option(args, 'format'));
  const metadata =
    format === 'json-schema'
      ? {
          method: option(args, 'method') ?? 'ALL',
          target: option(args, 'target') ?? 'response',
          urlPattern: option(args, 'url') ?? '/',
          urlPatternKind: option(args, 'match') ?? 'literal',
        }
      : undefined;
  const changes = await diffContractFiles(io, previous, next, format, metadata);
  io.stdout(formatChanges(changes, option(args, 'output') === 'json'));
  return changes.some(isBreaking) ? ExitCode.Violation : ExitCode.Success;
}

interface ParsedArguments {
  readonly positional: string[];
  readonly options: Map<string, string>;
  readonly flags: Set<string>;
}

function parseArguments(values: readonly string[]): ParsedArguments {
  const positional: string[] = [];
  const options = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) {
      positional.push(value);
      continue;
    }
    const [rawName, inline] = value.slice(2).split('=', 2);
    if (inline !== undefined) {
      options.set(rawName, inline);
      continue;
    }
    const next = values[index + 1];
    if (next && !next.startsWith('--')) {
      options.set(rawName, next);
      index += 1;
    } else {
      flags.add(rawName);
    }
  }
  return { positional, options, flags };
}

function option(args: ParsedArguments, name: string): string | undefined {
  return args.options.get(name);
}

async function detectFormat(
  content: string,
  requested: string | undefined,
): Promise<'openapi' | 'json-schema'> {
  if (requested) {
    if (requested !== 'openapi' && requested !== 'json-schema') {
      throw new Error('--format must be openapi or json-schema.');
    }
    return requested;
  }
  const confidence = await createOpenApiPlugin().canImport({
    id: 'detect',
    name: 'detect',
    content,
  });
  return confidence > 0 ? 'openapi' : 'json-schema';
}

function outputFormat(value: string): OutputFormat {
  if (value !== 'human' && value !== 'json' && value !== 'sarif') {
    throw new Error('--output must be human, json, or sarif.');
  }
  return value;
}

function helpText(): string {
  return `Kontrak — local API contract validation

Usage:
  kontrak import <contract-file> [--format openapi|json-schema]
  kontrak validate [recording.json] [--config kontrak.config.json] [--output human|json|sarif]
    [--sync-url http://localhost:3000 --project <id>]
  kontrak diff <previous> <next> [--format openapi|json-schema] [--output human|json]

Exit codes:
  0  success
  1  contract violation or breaking change
  2  usage, configuration, import, sync, or system error

Cloud sync:
  Set KONTRAK_API_KEY instead of passing --api-key to avoid shell history exposure.`;
}
