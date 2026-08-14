import { describe, expect, it } from 'vitest';
import { ValidationEngine } from './engine';
import type { ContractAdapter, ContractDocument, LocalExchange } from './types';

const exchange: LocalExchange = {
  id: 'exchange-1',
  sessionId: 'session-1',
  timestamp: 1,
  request: {
    method: 'GET',
    url: 'https://example.test/users',
    headers: {},
    body: { kind: 'empty' },
  },
  response: { status: 200, headers: {}, body: { kind: 'json', value: [] } },
};

function adapter(score = 10): ContractAdapter {
  return {
    format: 'fixture',
    match: () => ({ matched: true, score, diagnostics: [] }),
    validate: (input, contract) => ({
      exchangeId: input.id,
      contractId: contract.id,
      format: contract.format,
      status: 'valid',
      diagnostics: [],
    }),
  };
}

function contract(id: string, format = 'fixture'): ContractDocument {
  return { id, name: id, format, compiled: {} };
}

describe('ValidationEngine', () => {
  it('validates with the registered adapter', async () => {
    await expect(
      new ValidationEngine([adapter()]).validate(exchange, [contract('one')]),
    ).resolves.toMatchObject({
      status: 'valid',
      contractId: 'one',
    });
  });

  it('reports an explicit ambiguity instead of choosing by array order', async () => {
    const result = await new ValidationEngine([adapter()]).validate(exchange, [
      contract('one'),
      contract('two'),
    ]);
    expect(result.status).toBe('error');
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'core.match_ambiguous' }),
      ]),
    );
  });

  it('isolates adapter failures as diagnostics', async () => {
    const broken: ContractAdapter = {
      ...adapter(),
      match: () => {
        throw new Error('boom');
      },
    };
    const result = await new ValidationEngine([broken]).validate(exchange, [
      contract('one'),
    ]);
    expect(result.status).toBe('error');
    expect(result.diagnostics[0]?.code).toBe('core.match_failed');
  });

  it('bounds asynchronous plugin execution', async () => {
    const stalled: ContractAdapter = {
      ...adapter(),
      match: () => new Promise(() => undefined),
    };
    const result = await new ValidationEngine([stalled], {
      pluginTimeoutMs: 5,
    }).validate(exchange, [contract('one')]);
    expect(result.status).toBe('error');
    expect(result.diagnostics[0]?.code).toBe('core.match_timeout');
  });

  it('honors cancellation before plugin execution', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await new ValidationEngine([adapter()]).validate(
      exchange,
      [contract('one')],
      controller.signal,
    );
    expect(result.status).toBe('error');
    expect(result.diagnostics[0]?.code).toBe('core.match_cancelled');
  });
});
