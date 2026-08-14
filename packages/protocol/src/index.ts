import type { ContractValidationResult, LocalExchange } from '@kontrak/core';

export const PROTOCOL_VERSION = 1 as const;
export const PANEL_PORT_PREFIX = 'kontrak-panel' as const;

export interface NetworkCapturedMessage {
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly type: 'NETWORK_CAPTURED';
  readonly inspectedTabId: number;
  readonly payload: LocalExchange;
}

export interface ContractSummary {
  readonly id: string;
  readonly name: string;
  readonly format: string;
}

export interface ValidationPayload {
  readonly exchange: LocalExchange;
  readonly contract?: ContractSummary;
  readonly result: ContractValidationResult;
}

export interface ValidationCompletedMessage {
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly type: 'VALIDATION_COMPLETED';
  readonly inspectedTabId: number;
  readonly payload: ValidationPayload;
}

export type ExtensionMessage =
  | NetworkCapturedMessage
  | ValidationCompletedMessage;

export function panelPortName(inspectedTabId: number): string {
  return `${PANEL_PORT_PREFIX}:${inspectedTabId}`;
}

export function parsePanelPortName(name: string): number | undefined {
  const match = new RegExp(`^${PANEL_PORT_PREFIX}:(\\d+)$`).exec(name);
  if (!match) return undefined;
  const tabId = Number(match[1]);
  return Number.isSafeInteger(tabId) && tabId >= 0 ? tabId : undefined;
}

export function isNetworkCapturedMessage(
  value: unknown,
): value is NetworkCapturedMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<NetworkCapturedMessage>;
  return (
    candidate.protocolVersion === PROTOCOL_VERSION &&
    candidate.type === 'NETWORK_CAPTURED' &&
    Number.isSafeInteger(candidate.inspectedTabId) &&
    Number(candidate.inspectedTabId) >= 0 &&
    Boolean(candidate.payload && typeof candidate.payload === 'object')
  );
}

export function isValidationCompletedMessage(
  value: unknown,
): value is ValidationCompletedMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ValidationCompletedMessage>;
  return (
    candidate.protocolVersion === PROTOCOL_VERSION &&
    candidate.type === 'VALIDATION_COMPLETED' &&
    Number.isSafeInteger(candidate.inspectedTabId) &&
    Number(candidate.inspectedTabId) >= 0 &&
    Boolean(candidate.payload && typeof candidate.payload === 'object')
  );
}
