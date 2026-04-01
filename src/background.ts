import { validateRequest, matchSchema } from './core/validator';
import { getSchemas } from './storage/store';
import { NetworkRequest } from './core/types';

console.log("Kontrak Background Script loaded");

let panelPort: chrome.runtime.Port | null = null;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'kontrak-panel') {
    panelPort = port;
    port.onDisconnect.addListener(() => {
      panelPort = null;
    });
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'NETWORK_REQUEST') {
    handleNetworkRequest(message.payload);
  }
});

async function handleNetworkRequest(request: NetworkRequest) {
  const schemas = await getSchemas();
  const matchedSchema = matchSchema(request, schemas);

  if (matchedSchema) {
    const validationResult = validateRequest(request, matchedSchema);
    
    if (panelPort) {
      panelPort.postMessage({
        type: 'VALIDATION_RESULT',
        payload: {
          request,
          schema: matchedSchema,
          validationResult
        }
      });
    }
  }
}
