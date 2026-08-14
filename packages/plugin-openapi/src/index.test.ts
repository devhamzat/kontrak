import type { LocalExchange } from '@kontrak/core';
import { checkPluginConformance } from '@kontrak/plugin-sdk/testing';
import { describe, expect, it } from 'vitest';
import { createOpenApiPlugin } from './index';

const plugin = createOpenApiPlugin();

function document(version = '3.1.0') {
  return {
    openapi: version,
    info: { title: 'Pets', version: '1.0.0' },
    paths: {
      '/pets/{id}': {
        get: {
          operationId: 'getPet',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'integer' },
            },
            {
              name: 'include',
              in: 'query',
              schema: { type: 'boolean' },
            },
          ],
          responses: {
            '200': {
              description: 'Pet',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Pet' },
                },
              },
            },
            '4XX': { description: 'Client error' },
            default: { description: 'Unexpected error' },
          },
        },
      },
      '/pets': {
        post: {
          operationId: 'createPet',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PetInput' },
              },
            },
          },
          responses: {
            '201': {
              description: 'Created',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Pet' },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        PetInput: {
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string' } },
        },
        Pet: {
          type: 'object',
          required: ['id', 'name'],
          properties: {
            id: { type: 'integer' },
            name: { type: 'string' },
            friend: { $ref: '#/components/schemas/Pet' },
          },
        },
      },
    },
  };
}

function input(content: unknown) {
  return {
    id: 'pets-api',
    name: 'Pets API',
    uri: 'contracts/pets.yaml',
    content,
  };
}

function exchange(
  overrides: {
    method?: string;
    url?: string;
    requestBody?: LocalExchange['request']['body'];
    requestMediaType?: string;
    responseStatus?: number;
    responseBody?: LocalExchange['response']['body'];
    responseMediaType?: string;
    requestHeaders?: Record<string, string>;
  } = {},
): LocalExchange {
  return {
    id: 'exchange-1',
    sessionId: 'session-1',
    timestamp: 1,
    request: {
      method: overrides.method ?? 'GET',
      url: overrides.url ?? 'https://api.example.test/pets/42?include=true',
      mediaType: overrides.requestMediaType,
      headers: overrides.requestHeaders ?? {},
      body: overrides.requestBody ?? { kind: 'empty' },
    },
    response: {
      status: overrides.responseStatus ?? 200,
      mediaType: overrides.responseMediaType ?? 'application/json',
      headers: {},
      body:
        overrides.responseBody ??
        ({ kind: 'json', value: { id: 42, name: 'Ada' } } as const),
    },
  };
}

async function importedContract(content: unknown = document()) {
  const result = await plugin.import(input(content));
  expect(result.contracts).toHaveLength(1);
  return result.contracts[0];
}

describe('OpenAPI import', () => {
  it.each(['3.0.4', '3.1.2'])(
    'imports OpenAPI %s JSON documents',
    async (version) => {
      const result = await plugin.import(input(document(version)));
      expect(result.contracts[0]?.formatVersion).toBe(
        version.startsWith('3.0') ? '3.0' : '3.1',
      );
      expect(result.contracts[0]?.compiled.operations).toHaveLength(2);
    },
  );

  it('imports YAML documents', async () => {
    const result = await plugin.import(
      input(`
openapi: 3.1.0
info:
  title: Ping
  version: 1.0.0
paths:
  /ping:
    get:
      responses:
        '204':
          description: Empty
`),
    );
    expect(result.contracts[0]?.compiled.operations[0]?.operationId).toBe(
      'GET /ping',
    );
  });

  it('rejects unsupported versions and malformed YAML', async () => {
    const unsupported = await plugin.import(
      input({ ...document(), openapi: '2.0' }),
    );
    expect(unsupported.diagnostics[0]?.code).toBe(
      'openapi.version_unsupported',
    );
    const malformed = await plugin.import(input('openapi: [3.1.0'));
    expect(malformed.diagnostics[0]?.code).toBe('openapi.parse_failed');
  });

  it('rejects remote references', async () => {
    const value = document();
    const media = value.paths['/pets/{id}'].get.responses['200'].content[
      'application/json'
    ] as { schema: unknown };
    media.schema = {
      $ref: 'https://example.test/pet.yaml',
    };
    const result = await plugin.import(input(value));
    expect(result.contracts).toEqual([]);
    expect(result.diagnostics[0]?.code).toBe('openapi.remote_ref_disabled');
  });
});

describe('OpenAPI matching', () => {
  it('matches methods and templated paths', async () => {
    const contract = await importedContract();
    expect(await plugin.match(exchange(), contract)).toMatchObject({
      matched: true,
      operationId: 'getPet',
    });
    expect(
      await plugin.match(exchange({ method: 'DELETE' }), contract),
    ).toMatchObject({
      matched: false,
    });
  });

  it('reports equally specific overlapping operations', async () => {
    const value = document();
    const paths = value.paths as Record<string, unknown>;
    paths['/pets/{name}'] = {
      get: {
        operationId: 'getPetByName',
        responses: { '200': { description: 'Pet' } },
      },
    };
    const contract = await importedContract(value);
    const result = await plugin.match(exchange(), contract);
    expect(result.matched).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('openapi.operation_ambiguous');
  });
});

describe('OpenAPI validation', () => {
  it('validates path/query parameters and locally referenced responses', async () => {
    const contract = await importedContract();
    const value = exchange();
    const match = await plugin.match(value, contract);
    const result = await plugin.validate(value, contract, match);
    expect(result.status).toBe('valid');
    expect(result.operationId).toBe('getPet');
  });

  it('reports response schema errors with source pointers', async () => {
    const contract = await importedContract();
    const value = exchange({
      responseBody: { kind: 'json', value: { id: 'wrong' } },
    });
    const match = await plugin.match(value, contract);
    const result = await plugin.validate(value, contract, match);
    expect(result.status).toBe('invalid');
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'openapi.schema.required',
          source: expect.objectContaining({ uri: 'contracts/pets.yaml' }),
        }),
      ]),
    );
    expect(result.diagnostics.every((item) => item.source?.pointer)).toBe(true);
  });

  it('validates required request bodies and response status/media types', async () => {
    const contract = await importedContract();
    const missingBody = exchange({
      method: 'POST',
      url: 'https://api.example.test/pets',
      responseStatus: 201,
    });
    const missingMatch = await plugin.match(missingBody, contract);
    const missingResult = await plugin.validate(
      missingBody,
      contract,
      missingMatch,
    );
    expect(missingResult.diagnostics[0]?.code).toBe(
      'openapi.request_body_required',
    );

    const valid = exchange({
      method: 'POST',
      url: 'https://api.example.test/pets',
      requestMediaType: 'application/json; charset=utf-8',
      requestBody: { kind: 'json', value: { name: 'Ada' } },
      responseStatus: 201,
    });
    const match = await plugin.match(valid, contract);
    expect(await plugin.validate(valid, contract, match)).toMatchObject({
      status: 'valid',
    });

    const unsupportedMedia = {
      ...valid,
      request: { ...valid.request, mediaType: 'text/plain' },
    };
    const unsupportedResult = await plugin.validate(
      unsupportedMedia,
      contract,
      match,
    );
    expect(unsupportedResult.diagnostics[0]?.code).toBe(
      'openapi.request_media_type_unsupported',
    );
  });

  it('normalizes OpenAPI 3.0 nullable schemas', async () => {
    const value = document('3.0.4');
    const nullableMedia = value.paths['/pets/{id}'].get.responses['200']
      .content['application/json'] as { schema: unknown };
    nullableMedia.schema = {
      type: 'string',
      nullable: true,
    };
    const contract = await importedContract(value);
    const captured = exchange({ responseBody: { kind: 'json', value: null } });
    const match = await plugin.match(captured, contract);
    expect(await plugin.validate(captured, contract, match)).toMatchObject({
      status: 'valid',
    });
  });

  it('validates required header parameters from sanitized local headers', async () => {
    const value = document();
    value.paths['/pets/{id}'].get.parameters.push({
      name: 'X-Tenant',
      in: 'header',
      required: true,
      schema: { type: 'string' },
    });
    const contract = await importedContract(value);
    const missing = exchange();
    const missingMatch = await plugin.match(missing, contract);
    expect(
      (await plugin.validate(missing, contract, missingMatch)).diagnostics[0]
        ?.code,
    ).toBe('openapi.parameter_required');
    const present = exchange({ requestHeaders: { 'x-tenant': 'team-a' } });
    const presentMatch = await plugin.match(present, contract);
    expect(
      await plugin.validate(present, contract, presentMatch),
    ).toMatchObject({ status: 'valid' });
  });

  it('selects response ranges and default responses', async () => {
    const contract = await importedContract();
    for (const status of [404, 503]) {
      const value = exchange({
        responseStatus: status,
        responseBody: { kind: 'empty' },
      });
      const match = await plugin.match(value, contract);
      const result = await plugin.validate(value, contract, match);
      expect(result.status).toBe('valid');
    }
  });

  it('passes the public plugin conformance harness', async () => {
    await expect(
      checkPluginConformance(plugin, {
        input: input(document()),
        exchange: exchange(),
        expectedStatus: 'valid',
      }),
    ).resolves.toEqual([]);
  });
});
