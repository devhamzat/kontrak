import type { ContractDocument, Diagnostic } from '@kontrak/core';
import { createJsonSchemaPlugin } from '@kontrak/plugin-json-schema';
import { createOpenApiPlugin } from '@kontrak/plugin-openapi';
import type {
  CliIo,
  ContractConfig,
  KontrakConfig,
  LoadedContracts,
} from './types';
import path from 'node:path';

export function parseConfig(value: unknown): KontrakConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Kontrak config must be an object.');
  }
  const config = value as Partial<KontrakConfig>;
  if (config.version !== 1)
    throw new Error('Kontrak config version must be 1.');
  if (!Array.isArray(config.contracts))
    throw new Error('Kontrak config contracts must be an array.');
  config.contracts.forEach((contract, index) =>
    assertContractConfig(contract, index),
  );
  return config as KontrakConfig;
}

export async function loadConfiguredContracts(
  io: CliIo,
  configPath: string,
): Promise<LoadedContracts> {
  const absoluteConfig = path.resolve(io.cwd, configPath);
  const config = parseConfig(
    JSON.parse(await io.readFile(absoluteConfig)) as unknown,
  );
  const directory = path.dirname(absoluteConfig);
  const contracts: ContractDocument[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const item of config.contracts) {
    const sourcePath = path.resolve(directory, item.path);
    const content = await io.readFile(sourcePath);
    const imported = await importContract(item, content, sourcePath);
    contracts.push(...imported.contracts);
    diagnostics.push(...imported.diagnostics);
  }
  return { contracts, diagnostics };
}

export async function importContract(
  item: Omit<ContractConfig, 'path'>,
  content: string,
  uri?: string,
): Promise<LoadedContracts> {
  if (item.format === 'openapi') {
    return createOpenApiPlugin().import({
      id: item.id,
      name: item.name,
      content,
      uri,
    });
  }
  let schema: unknown;
  try {
    schema = JSON.parse(content) as unknown;
  } catch (error) {
    throw new Error(
      `JSON Schema "${item.name}" is not valid JSON: ${errorMessage(error)}`,
    );
  }
  return createJsonSchemaPlugin().import({
    id: item.id,
    name: item.name,
    content: schema,
    uri,
    metadata: item.metadata,
  });
}

function assertContractConfig(
  value: unknown,
  index: number,
): asserts value is ContractConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Contract ${index} must be an object.`);
  }
  const item = value as Partial<ContractConfig>;
  if (
    typeof item.id !== 'string' ||
    typeof item.name !== 'string' ||
    typeof item.path !== 'string'
  ) {
    throw new Error(
      `Contract ${index} requires string id, name, and path fields.`,
    );
  }
  if (item.format !== 'json-schema' && item.format !== 'openapi') {
    throw new Error(`Contract ${index} format must be json-schema or openapi.`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
