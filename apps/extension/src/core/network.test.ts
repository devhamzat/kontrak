import { describe, expect, it } from 'vitest';
import {
  MAX_CAPTURE_BODY_CHARS,
  capturedBody,
  parseResponseBody,
  sanitizedHeaders,
} from './network';

describe('parseResponseBody', () => {
  it.each([
    ['false', false],
    ['0', 0],
    ['null', null],
    ['""', ''],
  ])('preserves the JSON value represented by %s', (source, expected) => {
    expect(parseResponseBody(source)).toEqual({
      kind: 'json',
      value: expected,
    });
  });

  it('parses JSON objects', () => {
    expect(parseResponseBody('{"ok":true}')).toEqual({
      kind: 'json',
      value: { ok: true },
    });
  });

  it('returns non-JSON text as a typed text body', () => {
    expect(parseResponseBody('plain text')).toEqual({
      kind: 'text',
      value: 'plain text',
    });
  });

  it('distinguishes an empty response from JSON null', () => {
    expect(parseResponseBody('')).toEqual({ kind: 'empty' });
    expect(parseResponseBody('null')).toEqual({ kind: 'json', value: null });
  });
});

describe('sanitizedHeaders', () => {
  it('keeps contract-relevant headers while removing common credentials', () => {
    expect(
      sanitizedHeaders([
        { name: 'X-Request-ID', value: 'request-1' },
        { name: 'Authorization', value: 'Bearer secret' },
        { name: 'Cookie', value: 'session=secret' },
        { name: 'X-API-Key', value: 'secret' },
      ]),
    ).toEqual({ 'x-request-id': 'request-1' });
  });
});

describe('capturedBody', () => {
  it('represents encoded bodies without transferring decoded binary data', () => {
    expect(capturedBody('YWJj', 'base64')).toEqual({
      kind: 'binary',
      byteLength: 3,
      encoding: 'base64',
    });
  });

  it('rejects oversized bodies before extension-context transfer', () => {
    expect(capturedBody('x'.repeat(MAX_CAPTURE_BODY_CHARS + 1))).toMatchObject({
      kind: 'unavailable',
    });
  });
});
