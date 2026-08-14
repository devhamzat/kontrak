import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_VERSION,
  isNetworkCapturedMessage,
  panelPortName,
  parsePanelPortName,
} from './index';

describe('panel port names', () => {
  it('round-trips inspected tab identifiers', () => {
    expect(parsePanelPortName(panelPortName(42))).toBe(42);
  });

  it.each([
    'kontrak-panel',
    'other:42',
    'kontrak-panel:-1',
    'kontrak-panel:abc',
  ])('rejects invalid port name %s', (name) =>
    expect(parsePanelPortName(name)).toBeUndefined(),
  );
});

describe('network message guard', () => {
  it('rejects messages from incompatible protocol versions', () => {
    expect(
      isNetworkCapturedMessage({
        protocolVersion: PROTOCOL_VERSION + 1,
        type: 'NETWORK_CAPTURED',
        inspectedTabId: 1,
        payload: {},
      }),
    ).toBe(false);
  });
});
