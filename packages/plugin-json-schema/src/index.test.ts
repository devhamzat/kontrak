import type { LocalExchange } from '@kontrak/core';
import { checkPluginConformance } from '@kontrak/plugin-sdk/testing';
import { describe, expect, it } from 'vitest';
import { createJsonSchemaPlugin } from './index';

const plugin = createJsonSchemaPlugin();

function exchange(
  value: unknown = { id: 42 },
  options: { method?: string; url?: string } = {},
): LocalExchange {
  return {
    id: 'exchange-1',
    sessionId: 'session-1',
    timestamp: 1,
    request: {
      method: options.method ?? 'GET',
      url: options.url ?? 'https://example.test/api/users/42',
      headers: {},
      body: { kind: 'empty' },
    },
    response: {
      status: 200,
      headers: {},
      body: { kind: 'json', value },
    },
  };
}

function input(content: unknown, metadata: Record<string, unknown> = {}) {
  return {
    id: 'user-response',
    name: 'User response',
    content,
    metadata: {
      method: 'GET',
      target: 'response',
      urlPattern: '/api/users/',
      urlPatternKind: 'literal',
      ...metadata,
    },
  };
}

const userSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'number' } },
};

describe('JSON Schema import', () => {
  it.each([
    ['http://json-schema.org/draft-07/schema#', 'draft-07'],
    ['https://json-schema.org/draft/2019-09/schema', '2019-09'],
    ['https://json-schema.org/draft/2020-12/schema', '2020-12'],
  ])('supports the %s dialect', async (declaration, expected) => {
    const result = await plugin.import(
      input({ ...userSchema, $schema: declaration }),
    );
    expect(result.contracts[0]?.formatVersion).toBe(expected);
    expect(result.diagnostics).toEqual([]);
  });

  it('defaults missing dialect declarations with a warning', async () => {
    const result = await plugin.import(input({ type: 'string' }));
    expect(result.contracts[0]?.formatVersion).toBe('draft-07');
    expect(result.diagnostics[0]?.code).toBe('json-schema.dialect_defaulted');
  });

  it('supports boolean JSON Schemas', async () => {
    const imported = await plugin.import(input(false));
    const contract = imported.contracts[0];
    const match = await plugin.match(exchange(), contract);
    const result = await plugin.validate(exchange(), contract, match);
    expect(result.status).toBe('invalid');
  });

  it('rejects circular object inputs without recursing forever', async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const result = await plugin.import(input(circular));
    expect(result.contracts).toEqual([]);
    expect(result.diagnostics[0]?.code).toBe('json-schema.depth_exceeded');
  });

  it('rejects malformed JSON', async () => {
    const result = await plugin.import(input('{'));
    expect(result.contracts).toEqual([]);
    expect(result.diagnostics[0]?.code).toBe('json-schema.invalid_json');
  });

  it('rejects unsupported dialects', async () => {
    const result = await plugin.import(
      input({ $schema: 'https://example.test/custom' }),
    );
    expect(result.contracts).toEqual([]);
    expect(result.diagnostics[0]?.code).toBe('json-schema.dialect_unsupported');
  });

  it('rejects invalid regular expressions during import', async () => {
    const result = await plugin.import(
      input(userSchema, { urlPatternKind: 'regex', urlPattern: '[' }),
    );
    expect(result.contracts).toEqual([]);
    expect(result.diagnostics[0]?.code).toBe('json-schema.regex_invalid');
  });

  it('rejects remote references and accepts local references', async () => {
    const remote = await plugin.import(
      input({
        ...userSchema,
        properties: { user: { $ref: 'https://example.test/user.json' } },
      }),
    );
    expect(remote.diagnostics[0]?.code).toBe('json-schema.remote_ref_disabled');

    const local = await plugin.import(
      input({
        ...userSchema,
        $defs: { identifier: { type: 'number' } },
        properties: { id: { $ref: '#/$defs/identifier' } },
      }),
    );
    expect(local.contracts).toHaveLength(1);
  });
});

describe('JSON Schema matching and validation', () => {
  it('matches explicit literal patterns and validates responses', async () => {
    const imported = await plugin.import(input(userSchema));
    const contract = imported.contracts[0];
    const match = await plugin.match(exchange(), contract);
    const result = await plugin.validate(exchange(), contract, match);
    expect(match.matched).toBe(true);
    expect(result.status).toBe('valid');
  });

  it('returns normalized diagnostics for invalid responses', async () => {
    const imported = await plugin.import(input(userSchema));
    const contract = imported.contracts[0];
    const invalidExchange = exchange({});
    const match = await plugin.match(invalidExchange, contract);
    const result = await plugin.validate(invalidExchange, contract, match);
    expect(result.status).toBe('invalid');
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'json-schema.required',
          phase: 'response',
          severity: 'error',
        }),
      ]),
    );
  });

  it('can target request bodies', async () => {
    const imported = await plugin.import(
      input({ type: 'string' }, { target: 'request' }),
    );
    const contract = imported.contracts[0];
    const requestExchange: LocalExchange = {
      ...exchange(),
      request: {
        ...exchange().request,
        body: { kind: 'json', value: 'hello' },
      },
    };
    const match = await plugin.match(requestExchange, contract);
    expect(
      await plugin.validate(requestExchange, contract, match),
    ).toMatchObject({
      status: 'valid',
    });
  });

  it('passes the public conformance harness', async () => {
    await expect(
      checkPluginConformance(plugin, {
        input: input(userSchema),
        exchange: exchange(),
        expectedStatus: 'valid',
      }),
    ).resolves.toEqual([]);
  });
});
