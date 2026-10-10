import { describe, expect, it } from 'vitest';
import { pickCompareTarget, swapPair } from './imageCompare';

const a = { localId: 'a' };
const b = { localId: 'b' };

describe('pickCompareTarget', () => {
  it('pairs two distinct images', () => {
    expect(pickCompareTarget(a, b)).toEqual({ a, b });
  });

  it('rejects the same image or a side that was not found', () => {
    const notFound = [a, b].find((image) => image.localId === 'missing');
    expect(pickCompareTarget(a, a)).toBeNull();
    expect(pickCompareTarget(notFound, b)).toBeNull();
    expect(pickCompareTarget(a, notFound)).toBeNull();
  });
});

describe('swapPair', () => {
  it('swaps sides', () => {
    expect(swapPair({ a, b })).toEqual({ a: b, b: a });
  });
});
