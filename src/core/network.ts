import { NetworkRequest } from './types';

export function setupNetworkListener() {
  if (!chrome.devtools || !chrome.devtools.network) {
    console.warn('DevTools Network API not available');
    return;
  }

  chrome.devtools.network.onRequestFinished.addListener((request) => {
    request.getContent((body) => {
      let parsedBody = body;
      try {
        parsedBody = body ? JSON.parse(body) : null;
      } catch (e) {
      }

      const networkRequest: NetworkRequest = {
        id: crypto.randomUUID(),
        url: request.request.url,
        method: request.request.method,
        statusCode: request.response.status,
        responseBody: parsedBody || body,
        timestamp: Date.now()
      };

      chrome.runtime.sendMessage({
        type: 'NETWORK_REQUEST',
        payload: networkRequest
      }).catch(() => {
      });
    });
  });
}
