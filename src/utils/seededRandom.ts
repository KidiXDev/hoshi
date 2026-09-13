/**
 * Deterministic PRNG helpers. Used to make `{a|b}` dynamic prompt picks
 * reproducible from the generation seed.
 */

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.codePointAt(index) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Creates a splitmix32 generator returning floats in [0, 1).
 * `seed` may exceed 2^32 (ComfyUI seeds go up to ~1e10); high bits are folded
 * in so distinct seeds stay distinct. `salt` derives independent streams from
 * the same seed (e.g. positive vs negative prompt).
 */
export function createSeededRandom(seed: number, salt = ''): () => number {
  const safeSeed = Number.isFinite(seed) ? Math.abs(Math.trunc(seed)) : 0;
  const low = safeSeed >>> 0;
  const high = Math.floor(safeSeed / 2 ** 32) >>> 0;
  let state = (low ^ Math.imul(high, 0x9e3779b1) ^ fnv1a(salt)) >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    z = (z ^ (z >>> 15)) >>> 0;
    return z / 4294967296;
  };
}
