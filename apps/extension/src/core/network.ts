import type { ExchangeBody, HeaderMap, LocalExchange } from '@kontrak/core';
import {
  PROTOCOL_VERSION,
  type NetworkCapturedMessage,
} from '@kontrak/protocol';

export function parseResponseBody(body: string): ExchangeBody {
  if (body === '') return { kind: 'empty' };

  try {
    return { kind: 'json', value: JSON.parse(body) };
  } catch {
    return { kind: 'text', value: body };
  }
}

export const MAX_CAPTURE_BODY_CHARS = 1_000_000;

export function capturedBody(body: string, encoding?: string): ExchangeBody {
  if (encoding) {
    return {
      kind: 'binary',
      byteLength: Math.floor((body.length * 3) / 4),
      encoding,
    };
  }
  if (body.length > MAX_CAPTURE_BODY_CHARS) {
    return {
      kind: 'unavailable',
      reason: `Body exceeds the local capture limit of ${MAX_CAPTURE_BODY_CHARS} characters.`,
    };
  }
  return parseResponseBody(body);
}

function mediaType(
  headers: ReadonlyArray<{ name: string; value: string }>,
): string | undefined {
  const value = headers.find(
    (header) => header.name.toLowerCase() === 'content-type',
  )?.value;
  return value?.split(';', 1)[0]?.trim().toLowerCase() || undefined;
}

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
]);

export function sanitizedHeaders(
  headers: ReadonlyArray<{ name: string; value: string }>,
): HeaderMap {
  return Object.freeze(
    Object.fromEntries(
      headers
        .map((header) => [header.name.toLowerCase(), header.value] as const)
        .filter(([name]) => !SENSITIVE_HEADERS.has(name)),
    ),
  );
}

export function setupNetworkListener(sessionId: string): void {
  if (!chrome.devtools?.network) {
    console.warn('DevTools Network API not available');
    return;
  }

  const inspectedTabId = chrome.devtools.inspectedWindow.tabId;

  chrome.devtools.network.onRequestFinished.addListener((request) => {
    request.getContent((body, encoding) => {
      const exchange: LocalExchange = {
        id: crypto.randomUUID(),
        sessionId,
        timestamp: Date.now(),
        request: {
          url: request.request.url,
          method: request.request.method,
          mediaType: mediaType(request.request.headers),
          headers: sanitizedHeaders(request.request.headers),
          body:
            request.request.postData?.text !== undefined
              ? capturedBody(request.request.postData.text)
              : { kind: 'empty' },
        },
        response: {
          status: request.response.status,
          mediaType: mediaType(request.response.headers),
          headers: sanitizedHeaders(request.response.headers),
          body: capturedBody(body, encoding),
        },
      };

      const message: NetworkCapturedMessage = {
        protocolVersion: PROTOCOL_VERSION,
        type: 'NETWORK_CAPTURED',
        inspectedTabId,
        payload: exchange,
      };

      chrome.runtime.sendMessage(message).catch(() => {
        // The background service worker may be unavailable during extension reload.
      });
    });
  });
}
