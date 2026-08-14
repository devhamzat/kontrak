import type { LocalExchange } from '@kontrak/core';
import { createRecording, parseRecording } from './index';
import { describe, expect, it } from 'vitest';

const exchange: LocalExchange = {
  id: 'one',
  sessionId: 'session',
  timestamp: 1,
  request: {
    method: 'POST',
    url: 'https://example.test/users',
    headers: { authorization: 'Bearer secret', 'x-request-id': 'one' },
    body: {
      kind: 'json',
      value: { email: 'a@example.test', password: 'secret' },
    },
  },
  response: {
    status: 201,
    headers: {},
    body: { kind: 'json', value: { id: 1 } },
  },
};

describe('Kontrak recordings', () => {
  it('creates versioned recordings with explicit redaction metadata', () => {
    const recording = createRecording([exchange], { jsonKeys: ['password'] });
    expect(recording).toMatchObject({
      format: 'kontrak-recording',
      version: 1,
    });
    expect(recording.exchanges[0].request.headers).toEqual({
      'x-request-id': 'one',
    });
    expect(recording.exchanges[0].request.body).toEqual({
      kind: 'json',
      value: { email: 'a@example.test', password: '[REDACTED]' },
    });
    expect(parseRecording(recording)).toBe(recording);
  });

  it('rejects incompatible versions and malformed exchanges', () => {
    expect(() =>
      parseRecording({ format: 'kontrak-recording', version: 2 }),
    ).toThrow(/version/);
    expect(() =>
      parseRecording({
        format: 'kontrak-recording',
        version: 1,
        createdAt: 'now',
        exchanges: [{}],
      }),
    ).toThrow(/Exchange 0/);
  });
});
