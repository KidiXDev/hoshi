import { describe, expect, it } from 'vitest';
import {
  dimensionsForMegapixels,
  isDimensionAligned,
  matchMossSize,
  MOSS_ASPECT_RATIOS,
  MOSS_MEGAPIXELS,
  nearestMossMegapixels,
  parseAspectRatio,
  snapDimension
} from './resolution';

describe('resolution', () => {
  it('flags dimensions that are not positive multiples of 16', () => {
    expect(isDimensionAligned(1024)).toBe(true);
    expect(isDimensionAligned(1000)).toBe(false);
    expect(isDimensionAligned(0)).toBe(false);
  });

  it('snaps to the nearest multiple of 16 with a floor of 16', () => {
    expect(snapDimension(1000)).toBe(1008);
    expect(snapDimension(1030)).toBe(1024);
    expect(snapDimension(3)).toBe(16);
  });

  it('computes common sizes for a megapixel target', () => {
    expect(dimensionsForMegapixels(1, 1, 1)).toEqual({
      width: 1024,
      height: 1024
    });
    expect(dimensionsForMegapixels(16, 9, 1)).toEqual({
      width: 1360,
      height: 768
    });
    expect(dimensionsForMegapixels(3, 2, 1.5)).toEqual({
      width: 1536,
      height: 1024
    });
  });

  it('keeps every MOSS option aligned and close to its target', () => {
    for (const ratio of MOSS_ASPECT_RATIOS) {
      for (const megapixels of MOSS_MEGAPIXELS) {
        const { width, height } = dimensionsForMegapixels(
          ...parseAspectRatio(ratio),
          megapixels
        );
        expect(isDimensionAligned(width) && isDimensionAligned(height)).toBe(
          true
        );
        expect(
          Math.abs((width * height) / 2 ** 20 - megapixels) / megapixels
        ).toBeLessThan(0.03);
      }
    }
  });

  it('matches a size back to its ratio and megapixel option', () => {
    expect(matchMossSize(1536, 1024)).toEqual({
      ratio: '3:2',
      megapixels: 1.5
    });
    expect(matchMossSize(1000, 1000)).toBeNull();
  });

  it('picks the closest megapixel option for a custom size', () => {
    expect(nearestMossMegapixels(832, 1216)).toBe(1);
    expect(nearestMossMegapixels(1600, 1200)).toBe(2);
  });
});
