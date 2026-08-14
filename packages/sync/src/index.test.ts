import type { ContractValidationResult, LocalExchange } from '@kontrak/core';
import { describe, expect, it, vi } from 'vitest';
import {
  assertCloudSafe,
  createSanitizedReport,
  SyncClient,
  type SyncTransport,
} from './index';

const exchange: LocalExchange = {
  id: 'exchange-1',
  sessionId: 'local-session',
  timestamp: Date.UTC(2026, 7, 12),
  request: {
    method: 'GET',
    url: 'https://api.example.test/users?api_key=private#fragment',
    mediaType: 'application/json',
    headers: { authorization: 'Bearer secret', cookie: 'session=secret' },
    body: { kind: 'json', value: { password: 'secret' } },
  },
  response: {
    status: 200,
    mediaType: 'application/json',
    headers: { 'set-cookie': 'session=secret' },
    body: { kind: 'json', value: { email: 'private@example.test' } },
  },
};

const result: ContractValidationResult = {
  exchangeId: exchange.id,
  contractId: 'contract-1',
  format: 'openapi',
  operationId: 'listUsers',
  status: 'invalid',
  diagnostics: [
    {
      code: 'response.schema',
      message: 'Expected an array.',
      severity: 'error',
      phase: 'response',
      path: '/response',
    },
  ],
};

describe('privacy-safe synchronization', () => {
  it('creates a useful report without query values, headers, or bodies', () => {
    const report = createSanitizedReport({
      projectId: 'project-1',
      contractVersionId: 'version-1',
      exchange,
      result,
    });

    expect(report.request).toEqual({
      method: 'GET',
      origin: 'https://api.example.test',
      pathname: '/users',
    });
    expect(JSON.stringify(report)).not.toMatch(
      /private|secret|api_key|authorization|headers|body|Expected an array/i,
    );
  });

  it('rejects sensitive fields recursively before transport', async () => {
    const sendReport = vi.fn<SyncTransport['sendReport']>();
    const client = new SyncClient({ sendReport });
    const unsafe = {
      ...createSanitizedReport({ projectId: 'project-1', exchange, result }),
      metadata: { token: 'secret' },
    };

    await expect(
      client.send(unsafe as ReturnType<typeof createSanitizedReport>),
    ).rejects.toThrow('forbids sensitive field');
    expect(sendReport).not.toHaveBeenCalled();
  });

  it('rejects cycles rather than bypassing recursive inspection', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => assertCloudSafe(cyclic)).toThrow('cyclic');
  });
});
