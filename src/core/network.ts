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
        // Not a JSON response, leaving as string
      }

      const networkRequest: NetworkRequest = {
        id: crypto.randomUUID(),
        url: request.request.url,
        method: request.request.method,
        statusCode: request.response.status,
        responseBody: parsedBody || body,
        timestamp: Date.now()
      };

      // Send the captured request to the background script
      chrome.runtime.sendMessage({
        type: 'NETWORK_REQUEST',
        payload: networkRequest
      }).catch(() => {
        // Ignored. The background script might be inactive or not listening.
      });
    });
  });
}
