/** Pairing helpers for the gallery A/B comparison. */

export interface ComparePair<T> {
  a: T;
  b: T;
}

/**
 * Returns the pair to compare, or `null` when source and target are the same
 * image (nothing to compare).
 */
export function pickCompareTarget<T extends { localId: string }>(
  source: T | undefined,
  target: T | undefined
): ComparePair<T> | null {
  if (!source || !target || source.localId === target.localId) return null;
  return { a: source, b: target };
}

export function swapPair<T>(pair: ComparePair<T>): ComparePair<T> {
  return { a: pair.b, b: pair.a };
}
