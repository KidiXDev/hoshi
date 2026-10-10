import { describe, expect, it } from 'vitest';
import { isNewerVersion } from './version';

describe('isNewerVersion', () => {
  it.each([
    ['v1.10.0', 'v1.9.0', true],
    ['v2.0.0', 'v1.99.0', true],
    ['v1.0.0', 'v1.0.0', false],
    ['v1.9.0', 'v1.10.0', false]
  ])('%s newer than %s → %s', (candidate, current, expected) => {
    expect(isNewerVersion(candidate, current)).toBe(expected);
  });
});
