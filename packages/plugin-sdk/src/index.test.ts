import type { ContractPlugin } from './index';
import { PLUGIN_API_VERSION, definePlugin, diagnostic } from './index';
import { describe, expect, it } from 'vitest';

function fixturePlugin(
  overrides: Partial<ContractPlugin> = {},
): ContractPlugin {
  return {
    format: 'fixture',
    manifest: {
      id: 'fixture',
      name: 'Fixture',
      version: '1.0.0',
      apiVersion: PLUGIN_API_VERSION,
      formats: ['fixture'],
    },
    canImport: () => 1,
    import: () => ({ contracts: [], diagnostics: [] }),
    match: () => ({ matched: false, score: 0, diagnostics: [] }),
    validate: (exchange) => ({
      exchangeId: exchange.id,
      status: 'skipped',
      diagnostics: [],
    }),
    ...overrides,
  };
}

describe('definePlugin', () => {
  it('accepts a plugin that declares its format', () => {
    expect(definePlugin(fixturePlugin()).format).toBe('fixture');
  });

  it('rejects an undeclared adapter format', () => {
    expect(() =>
      definePlugin(
        fixturePlugin({
          manifest: { ...fixturePlugin().manifest, formats: ['other'] },
        }),
      ),
    ).toThrow(/does not declare/);
  });
});

describe('diagnostic', () => {
  it('provides stable import defaults', () => {
    expect(diagnostic('fixture.invalid', 'Invalid fixture')).toEqual({
      code: 'fixture.invalid',
      message: 'Invalid fixture',
      severity: 'error',
      phase: 'import',
    });
  });
});
