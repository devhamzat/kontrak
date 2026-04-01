import { ApiSchema } from '../core/types';

export const SCHEMAS_KEY = 'api_validator_schemas';

export async function getSchemas(): Promise<ApiSchema[]> {
  return new Promise((resolve) => {
    chrome.storage.local.get([SCHEMAS_KEY], (result) => {
      resolve(result[SCHEMAS_KEY] || []);
    });
  });
}

export async function saveSchemas(schemas: ApiSchema[]): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [SCHEMAS_KEY]: schemas }, () => {
      resolve();
    });
  });
}
