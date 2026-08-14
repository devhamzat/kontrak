import type { LegacyApiSchema, StoredContract } from '../core/types';

export const CONTRACTS_KEY = 'kontrak_contracts';
export const LEGACY_SCHEMAS_KEY = 'api_validator_schemas';

export function migrateLegacySchemas(
  schemas: readonly LegacyApiSchema[],
): StoredContract[] {
  return schemas.map((schema) => ({
    ...schema,
    format: 'json-schema',
    // The MVP interpreted every URL pattern as a regular expression.
    urlPatternKind: schema.urlPatternKind ?? 'regex',
  }));
}

export async function getContracts(): Promise<StoredContract[]> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get([CONTRACTS_KEY, LEGACY_SCHEMAS_KEY], (result) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      if (Array.isArray(result[CONTRACTS_KEY])) {
        resolve(result[CONTRACTS_KEY] as StoredContract[]);
        return;
      }
      const legacy = Array.isArray(result[LEGACY_SCHEMAS_KEY])
        ? (result[LEGACY_SCHEMAS_KEY] as LegacyApiSchema[])
        : [];
      resolve(migrateLegacySchemas(legacy));
    });
  });
}

export async function saveContracts(
  contracts: readonly StoredContract[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [CONTRACTS_KEY]: contracts }, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}
