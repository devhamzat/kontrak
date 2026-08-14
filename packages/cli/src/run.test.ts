import { createOpenApiPlugin } from '@kontrak/plugin-openapi';
import { createRecording } from '@kontrak/recording';
import type { LocalExchange } from '@kontrak/core';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from './run';
import type { CliIo } from './types';

const cwd = path.resolve('C:/kontrak-test');

function exchange(value: unknown): LocalExchange {
  return {
    id: 'exchange-1',
    sessionId: 'session-1',
    timestamp: 1,
    request: {
      method: 'GET',
      url: 'https://example.test/users',
      headers: {},
      body: { kind: 'empty' },
    },
    response: {
      status: 200,
      mediaType: 'application/json',
      headers: {},
      body: { kind: 'json', value },
    },
  };
}

const jsonSchema = JSON.stringify({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'array',
  items: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'number' } },
  },
});

const openApi = `openapi: 3.1.0
info:
  title: Users
  version: 1.0.0
paths:
  /users:
    get:
      operationId: listUsers
      responses:
        '200':
          description: Users
          content:
            application/json:
              schema:
                type: array
                items:
                  type: object
                  required: [id]
                  properties:
                    id: { type: number }
`;

function memoryIo(files: Record<string, string>) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const normalized = new Map(
    Object.entries(files).map(([file, content]) => [
      path.resolve(cwd, file),
      content,
    ]),
  );
  const io: CliIo = {
    cwd,
    readFile: async (file) => {
      const content = normalized.get(path.resolve(file));
      if (content === undefined) throw new Error(`Missing fixture ${file}`);
      return content;
    },
    stdout: (value) => stdout.push(value),
    stderr: (value) => stderr.push(value),
  };
  return { io, stdout, stderr };
}

describe('kontrak validate', () => {
  it('syncs only sanitized reports with a project API key', async () => {
    const recording = createRecording([exchange([{ id: 1 }])]);
    const config = {
      version: 1,
      contracts: [
        { id: 'users', name: 'Users', format: 'openapi', path: 'openapi.yaml' },
      ],
    };
    const capture = memoryIo({
      'kontrak.config.json': JSON.stringify(config),
      'recording.json': JSON.stringify(recording),
      'openapi.yaml': openApi,
    });
    const calls: Array<{ input: string; init: RequestInit }> = [];
    capture.io.env = { KONTRAK_API_KEY: 'ktrk_test-secret' };
    capture.io.fetch = async (input, init) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({ id: 'exchange-1' }), {
        status: 202,
      });
    };
    const code = await runCli(
      [
        'validate',
        'recording.json',
        '--sync-url',
        'http://localhost:3000/',
        '--project',
        'project-1',
      ],
      capture.io,
    );
    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].input).toBe('http://localhost:3000/api/v1/machine-reports');
    expect(calls[0].init.headers).toMatchObject({
      authorization: 'Bearer ktrk_test-secret',
    });
    const body = String(calls[0].init.body);
    expect(JSON.parse(body)).toMatchObject({
      projectId: 'project-1',
      request: { origin: 'https://example.test', pathname: '/users' },
    });
    expect(body).not.toMatch(/headers|body|message|ktrk_test-secret/i);
    expect(capture.stderr.at(-1)).toContain(
      'Synced 1 sanitized validation report',
    );
  });

  it('requires complete opt-in cloud configuration', async () => {
    const recording = createRecording([exchange([{ id: 1 }])]);
    const config = {
      version: 1,
      contracts: [
        { id: 'users', name: 'Users', format: 'openapi', path: 'openapi.yaml' },
      ],
    };
    const capture = memoryIo({
      'kontrak.config.json': JSON.stringify(config),
      'recording.json': JSON.stringify(recording),
      'openapi.yaml': openApi,
    });
    expect(
      await runCli(
        ['validate', 'recording.json', '--sync-url', 'http://localhost:3000'],
        capture.io,
      ),
    ).toBe(2);
    expect(capture.stderr.at(-1)).toContain('Cloud sync requires');
  });

  it('returns violation exit code and machine-readable JSON', async () => {
    const recording = createRecording([exchange([{}])]);
    const config = {
      version: 1,
      contracts: [
        {
          id: 'users',
          name: 'Users',
          format: 'json-schema',
          path: 'users.schema.json',
          metadata: {
            method: 'GET',
            target: 'response',
            urlPattern: '/users',
            urlPatternKind: 'literal',
          },
        },
      ],
    };
    const capture = memoryIo({
      'kontrak.config.json': JSON.stringify(config),
      'recording.json': JSON.stringify(recording),
      'users.schema.json': jsonSchema,
    });
    const code = await runCli(
      ['validate', 'recording.json', '--output', 'json'],
      capture.io,
    );
    expect(code).toBe(1);
    expect(JSON.parse(capture.stdout[0])).toMatchObject({
      summary: { invalid: 1 },
      validations: [{ status: 'invalid' }],
    });
  });

  it('emits SARIF and preserves extension/plugin validation parity', async () => {
    const capturedExchange = exchange([{}]);
    const recording = createRecording([capturedExchange]);
    const config = {
      version: 1,
      contracts: [
        { id: 'users', name: 'Users', format: 'openapi', path: 'openapi.yaml' },
      ],
    };
    const capture = memoryIo({
      'kontrak.config.json': JSON.stringify(config),
      'recording.json': JSON.stringify(recording),
      'openapi.yaml': openApi,
    });
    const code = await runCli(
      ['validate', 'recording.json', '--output', 'sarif'],
      capture.io,
    );
    const sarif = JSON.parse(capture.stdout[0]);
    expect(code).toBe(1);
    expect(sarif).toMatchObject({
      version: '2.1.0',
      runs: [{ results: expect.any(Array) }],
    });

    const plugin = createOpenApiPlugin();
    const imported = await plugin.import({
      id: 'users',
      name: 'Users',
      content: openApi,
    });
    const match = await plugin.match(capturedExchange, imported.contracts[0]);
    const direct = await plugin.validate(
      capturedExchange,
      imported.contracts[0],
      match,
    );
    expect(direct.status).toBe('invalid');
  });
});

describe('kontrak import and diff', () => {
  it('inspects an OpenAPI document', async () => {
    const capture = memoryIo({ 'openapi.yaml': openApi });
    expect(await runCli(['import', 'openapi.yaml'], capture.io)).toBe(0);
    expect(JSON.parse(capture.stdout[0])).toMatchObject({
      format: 'openapi',
      operations: 1,
    });
  });

  it('returns violation exit code for plugin-reported breaking changes', async () => {
    const previous = JSON.stringify({
      type: 'object',
      properties: { id: { type: 'number' } },
    });
    const next = JSON.stringify({ type: 'object', properties: {} });
    const capture = memoryIo({ 'old.json': previous, 'new.json': next });
    const code = await runCli(
      ['diff', 'old.json', 'new.json', '--format', 'json-schema'],
      capture.io,
    );
    expect(code).toBe(1);
    expect(capture.stdout[0]).toContain('json-schema.property_removed');
  });
});
