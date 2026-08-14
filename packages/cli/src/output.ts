import type { Diagnostic } from '@kontrak/core';
import type { ExchangeValidation } from './types';

export type OutputFormat = 'human' | 'json' | 'sarif';

export function formatValidation(
  values: readonly ExchangeValidation[],
  format: OutputFormat,
): string {
  if (format === 'json') {
    return JSON.stringify(
      {
        summary: summary(values),
        validations: values.map(({ exchange, result }) => ({
          method: exchange.request.method,
          url: exchange.request.url,
          responseStatus: exchange.response.status,
          ...result,
        })),
      },
      null,
      2,
    );
  }
  if (format === 'sarif') return JSON.stringify(toSarif(values), null, 2);
  const lines = values.map(({ exchange, result }) => {
    const icon =
      result.status === 'valid'
        ? 'PASS'
        : result.status === 'skipped'
          ? 'SKIP'
          : 'FAIL';
    const heading = `${icon} ${exchange.request.method} ${exchange.request.url} -> ${exchange.response.status}`;
    const details = result.diagnostics.map(
      (item) => `  ${item.code} ${item.path ?? '/'}: ${item.message}`,
    );
    return [heading, ...details].join('\n');
  });
  const counts = summary(values);
  return [
    ...lines,
    '',
    `Summary: ${counts.valid} valid, ${counts.invalid} invalid, ${counts.error} errors, ${counts.skipped} unmatched`,
  ].join('\n');
}

export function formatDiagnostics(diagnostics: readonly Diagnostic[]): string {
  return diagnostics
    .map(
      (item) => `${item.severity.toUpperCase()} ${item.code}: ${item.message}`,
    )
    .join('\n');
}

function summary(values: readonly ExchangeValidation[]) {
  return {
    valid: values.filter((item) => item.result.status === 'valid').length,
    invalid: values.filter((item) => item.result.status === 'invalid').length,
    error: values.filter((item) => item.result.status === 'error').length,
    skipped: values.filter((item) => item.result.status === 'skipped').length,
  };
}

function toSarif(values: readonly ExchangeValidation[]) {
  const diagnostics = values.flatMap(({ exchange, result }) =>
    result.diagnostics.map((item) => ({ exchange, result, item })),
  );
  const rules = new Map<string, Diagnostic>();
  diagnostics.forEach(({ item }) => rules.set(item.code, item));
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'Kontrak',
            informationUri: 'https://github.com/',
            rules: [...rules.values()].map((item) => ({
              id: item.code,
              shortDescription: { text: item.message },
            })),
          },
        },
        results: diagnostics.map(({ exchange, item }) => ({
          ruleId: item.code,
          level:
            item.severity === 'error'
              ? 'error'
              : item.severity === 'warning'
                ? 'warning'
                : 'note',
          message: {
            text: `${exchange.request.method} ${exchange.request.url}: ${item.message}`,
          },
          ...(item.source?.uri
            ? {
                locations: [
                  {
                    physicalLocation: {
                      artifactLocation: { uri: item.source.uri },
                      ...(item.source.line
                        ? {
                            region: {
                              startLine: item.source.line,
                              ...(item.source.column
                                ? { startColumn: item.source.column }
                                : {}),
                            },
                          }
                        : {}),
                    },
                  },
                ],
              }
            : {}),
        })),
      },
    ],
  };
}
