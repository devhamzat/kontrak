import {
  ValidationEngine,
  type ContractDocument,
  type Diagnostic,
  type LocalExchange,
} from '@kontrak/core';
import { createJsonSchemaPlugin } from '@kontrak/plugin-json-schema';
import { createOpenApiPlugin } from '@kontrak/plugin-openapi';
import {
  PROTOCOL_VERSION,
  isNetworkCapturedMessage,
  parsePanelPortName,
  type ValidationCompletedMessage,
} from '@kontrak/protocol';
import type { StoredContract } from './core/types';
import { getContracts } from './storage/store';

const panelPorts = new Map<number, Set<chrome.runtime.Port>>();
const jsonSchemaPlugin = createJsonSchemaPlugin();
const openApiPlugin = createOpenApiPlugin();
const engine = new ValidationEngine([jsonSchemaPlugin, openApiPlugin]);

chrome.runtime.onConnect.addListener((port) => {
  const inspectedTabId = parsePanelPortName(port.name);
  if (inspectedTabId === undefined) return;
  const ports =
    panelPorts.get(inspectedTabId) ?? new Set<chrome.runtime.Port>();
  ports.add(port);
  panelPorts.set(inspectedTabId, ports);
  port.onDisconnect.addListener(() => {
    ports.delete(port);
    if (ports.size === 0) panelPorts.delete(inspectedTabId);
  });
});

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (isNetworkCapturedMessage(message)) {
    void handleNetworkRequest(message.inspectedTabId, message.payload);
  }
});

async function handleNetworkRequest(
  inspectedTabId: number,
  exchange: LocalExchange,
): Promise<void> {
  const storedContracts = await getContracts();
  const contracts: ContractDocument[] = [];
  const importDiagnostics: Diagnostic[] = [];
  for (const stored of storedContracts) {
    const imported =
      stored.format === 'openapi'
        ? await openApiPlugin.import({
            id: stored.id,
            name: stored.name,
            content: stored.document,
          })
        : await jsonSchemaPlugin.import({
            id: stored.id,
            name: stored.name,
            content: stored.schema,
            metadata: {
              method: stored.method,
              target: 'response',
              urlPattern: stored.urlPattern,
              urlPatternKind: stored.urlPatternKind,
            },
          });
    contracts.push(...imported.contracts);
    importDiagnostics.push(...imported.diagnostics);
  }

  const engineResult = await engine.validate(exchange, contracts);
  const result = {
    ...engineResult,
    status:
      engineResult.status === 'skipped' &&
      importDiagnostics.some((item) => item.severity === 'error')
        ? ('error' as const)
        : engineResult.status,
    diagnostics: [...importDiagnostics, ...engineResult.diagnostics],
  };
  const stored = storedContracts.find(
    (candidate) => candidate.id === result.contractId,
  );
  postValidation(inspectedTabId, exchange, result, stored);
}

function postValidation(
  inspectedTabId: number,
  exchange: LocalExchange,
  result: Awaited<ReturnType<ValidationEngine['validate']>>,
  stored?: StoredContract,
): void {
  const message: ValidationCompletedMessage = {
    protocolVersion: PROTOCOL_VERSION,
    type: 'VALIDATION_COMPLETED',
    inspectedTabId,
    payload: {
      exchange,
      ...(stored
        ? {
            contract: {
              id: stored.id,
              name: stored.name,
              format: stored.format,
            },
          }
        : {}),
      result,
    },
  };
  for (const port of panelPorts.get(inspectedTabId) ?? [])
    port.postMessage(message);
}
