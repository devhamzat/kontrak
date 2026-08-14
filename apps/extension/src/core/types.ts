export interface StoredContractBase {
  id: string;
  name: string;
  format: 'json-schema' | 'openapi';
}

export interface StoredJsonSchemaContract extends StoredContractBase {
  format: 'json-schema';
  urlPattern: string;
  urlPatternKind: 'literal' | 'regex';
  method: string;
  schema: unknown;
}

export interface StoredOpenApiContract extends StoredContractBase {
  format: 'openapi';
  document: unknown;
}

export type StoredContract = StoredJsonSchemaContract | StoredOpenApiContract;

export interface LegacyApiSchema {
  id: string;
  name: string;
  urlPattern: string;
  urlPatternKind?: 'literal' | 'regex';
  method: string;
  schema: unknown;
}
