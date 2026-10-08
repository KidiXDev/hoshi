const SEED_RANGE = 10_000_000_000;

export function randomSeed(): number {
  return Math.floor(Math.random() * SEED_RANGE);
}

export function resolveSeed(seed: number): number {
  return seed < 0 ? randomSeed() : seed;
}
