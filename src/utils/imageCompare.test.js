import { describe, expect, test } from 'bun:test';
import { pickCompareTarget, swapPair } from './imageCompare';

const a = { localId: 'a' };
const b = { localId: 'b' };

describe('imageCompare', () => {
  test('pairs distinct images and rejects same/missing', () => {
    expect(pickCompareTarget(a, b)).toEqual({ a, b });
    expect(pickCompareTarget(a, a)).toBeNull();
    const [missing] = [];
    expect(pickCompareTarget(missing, b)).toBeNull();
    expect(pickCompareTarget(a, missing)).toBeNull();
  });

  test('swaps sides', () => {
    expect(swapPair({ a, b })).toEqual({ a: b, b: a });
  });
});
