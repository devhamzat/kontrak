import { describe, expect, it } from 'vitest';
import { migrateLegacySchemas } from './store';

describe('migrateLegacySchemas', () => {
  it('preserves MVP regex semantics while adding a format discriminator', () => {
    expect(
      migrateLegacySchemas([
        {
          id: 'one',
          name: 'Users',
          method: 'GET',
          urlPattern: '/users/.+',
          schema: { type: 'array' },
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        id: 'one',
        format: 'json-schema',
        urlPatternKind: 'regex',
      }),
    ]);
  });
});
