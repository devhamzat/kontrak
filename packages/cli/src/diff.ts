import { createJsonSchemaPlugin } from '@kontrak/plugin-json-schema';
import { createOpenApiPlugin } from '@kontrak/plugin-openapi';
import type { ContractChange } from '@kontrak/plugin-sdk';
import type { CliIo, ContractConfig } from './types';
import { importContract } from './config';
import path from 'node:path';

export async function diffContractFiles(
  io: CliIo,
  previousPath: string,
  nextPath: string,
  format: ContractConfig['format'],
  metadata?: Readonly<Record<string, unknown>>,
): Promise<readonly ContractChange[]> {
  const previousAbsolute = path.resolve(io.cwd, previousPath);
  const nextAbsolute = path.resolve(io.cwd, nextPath);
  const descriptor = {
    id: 'diff',
    name: 'Contract diff',
    format,
    metadata,
  } as const;
  const previous = await importContract(
    descriptor,
    await io.readFile(previousAbsolute),
    previousAbsolute,
  );
  const next = await importContract(
    descriptor,
    await io.readFile(nextAbsolute),
    nextAbsolute,
  );
  if (previous.contracts.length !== 1 || next.contracts.length !== 1) {
    const diagnostics = [...previous.diagnostics, ...next.diagnostics];
    throw new Error(
      diagnostics.map((item) => item.message).join('\n') ||
        'Contract import failed.',
    );
  }
  const plugin =
    format === 'openapi' ? createOpenApiPlugin() : createJsonSchemaPlugin();
  if (!plugin.diff)
    throw new Error(`The ${format} plugin does not support contract diffs.`);
  return plugin.diff(
    previous.contracts[0] as never,
    next.contracts[0] as never,
  );
}

export function formatChanges(
  changes: readonly ContractChange[],
  json: boolean,
): string {
  if (json)
    return JSON.stringify(
      { breaking: changes.filter(isBreaking).length, changes },
      null,
      2,
    );
  if (changes.length === 0)
    return 'No breaking or notable contract changes detected.';
  return changes
    .map(
      (change) =>
        `${change.severity === 'breaking' ? 'BREAKING' : change.severity.toUpperCase()} ${
          change.code
        }: ${change.message}${change.pointer ? ` (${change.pointer})` : ''}`,
    )
    .join('\n');
}

export function isBreaking(change: ContractChange): boolean {
  return change.severity === 'breaking';
}
