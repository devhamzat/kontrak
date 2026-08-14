const MAX_REFERENCE_DEPTH = 100;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function resolveObject(
  document: Record<string, unknown>,
  value: unknown,
  chain: readonly string[] = [],
): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const reference = value.$ref;
  if (reference === undefined) return value;
  if (typeof reference !== 'string') throw new Error('$ref must be a string.');
  if (!reference.startsWith('#')) {
    throw new Error(`Remote reference "${reference}" is disabled by default.`);
  }
  if (chain.includes(reference)) {
    throw new Error(
      `Circular non-schema reference detected: ${[...chain, reference].join(' -> ')}`,
    );
  }
  if (chain.length >= MAX_REFERENCE_DEPTH) {
    throw new Error(`Reference depth exceeds ${MAX_REFERENCE_DEPTH}.`);
  }
  const resolved = resolvePointer(document, reference);
  return resolveObject(document, resolved, [...chain, reference]);
}

export function resolvePointer(document: unknown, reference: string): unknown {
  if (reference === '#') return document;
  if (!reference.startsWith('#/')) {
    throw new Error(
      `Only local references are supported; received "${reference}".`,
    );
  }
  let current: unknown = document;
  for (const rawToken of reference.slice(2).split('/')) {
    const token = decodeURIComponent(rawToken)
      .replace(/~1/g, '/')
      .replace(/~0/g, '~');
    if (!isRecord(current) && !Array.isArray(current)) {
      throw new Error(`Reference "${reference}" does not resolve.`);
    }
    current = (current as Record<string, unknown>)[token];
    if (current === undefined)
      throw new Error(`Reference "${reference}" does not resolve.`);
  }
  return current;
}

export function findRemoteReference(
  value: unknown,
  seen = new WeakSet<object>(),
): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);
  if (
    isRecord(value) &&
    typeof value.$ref === 'string' &&
    !value.$ref.startsWith('#')
  ) {
    return value.$ref;
  }
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    const found = findRemoteReference(child, seen);
    if (found) return found;
  }
  return undefined;
}
