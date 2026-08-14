import type { ContractValidationResult, LocalExchange } from '@kontrak/core';
import type { ContractInput, ContractPlugin } from './index';

export interface PluginConformanceFixture {
  readonly input: ContractInput;
  readonly exchange: LocalExchange;
  readonly expectedStatus: ContractValidationResult['status'];
}

export async function checkPluginConformance(
  plugin: ContractPlugin,
  fixture: PluginConformanceFixture,
): Promise<readonly string[]> {
  const issues: string[] = [];
  const confidence = await plugin.canImport(fixture.input);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    issues.push('canImport must return a finite confidence between 0 and 1.');
  }

  const imported = await plugin.import(fixture.input);
  if (imported.contracts.length !== 1) {
    issues.push(
      `fixture import must produce one contract; received ${imported.contracts.length}.`,
    );
    return issues;
  }

  const contract = imported.contracts[0];
  if (contract.format !== plugin.format) {
    issues.push(
      `imported contract format "${contract.format}" does not match "${plugin.format}".`,
    );
  }

  const match = await plugin.match(fixture.exchange, contract);
  if (!match.matched) {
    issues.push('fixture exchange did not match its imported contract.');
    return issues;
  }
  if (!Number.isFinite(match.score) || match.score < 0) {
    issues.push('matched scores must be finite and non-negative.');
  }

  const result = await plugin.validate(fixture.exchange, contract, match);
  if (result.exchangeId !== fixture.exchange.id) {
    issues.push('validation result exchangeId does not match its input.');
  }
  if (result.contractId !== contract.id) {
    issues.push('validation result contractId does not match its input.');
  }
  if (result.status !== fixture.expectedStatus) {
    issues.push(
      `expected validation status "${fixture.expectedStatus}"; received "${result.status}".`,
    );
  }
  return issues;
}
