import type { AnySchema } from 'ajv';

export type OpenApiVersion = '3.0' | '3.1';

export interface OpenApiContract {
  readonly document: Record<string, unknown>;
  readonly version: OpenApiVersion;
  readonly operations: readonly OpenApiOperation[];
  readonly sourceUri?: string;
}

export interface OpenApiOperation {
  readonly key: string;
  readonly method: string;
  readonly pathTemplate: string;
  readonly pathRegex: RegExp;
  readonly pathParameterNames: readonly string[];
  readonly operationId: string;
  readonly parameters: readonly OpenApiParameter[];
  readonly requestBody?: OpenApiRequestBody;
  readonly responses: Readonly<Record<string, OpenApiResponse>>;
  readonly score: number;
}

export interface OpenApiParameter {
  readonly name: string;
  readonly location: 'path' | 'query' | 'header' | 'cookie';
  readonly required: boolean;
  readonly schema?: AnySchema;
  readonly sourcePath: string;
}

export interface OpenApiRequestBody {
  readonly required: boolean;
  readonly content: Readonly<Record<string, OpenApiMediaType>>;
  readonly sourcePath: string;
}

export interface OpenApiResponse {
  readonly content: Readonly<Record<string, OpenApiMediaType>>;
  readonly sourcePath: string;
}

export interface OpenApiMediaType {
  readonly schema?: AnySchema;
  readonly sourcePath: string;
}
