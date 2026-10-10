import { describe, expect, it } from 'vitest';
import { civitaiImageId, normalizeModelFilename } from './civitai';

describe('normalizeModelFilename', () => {
  it.each([
    'external\\portraits\\Model.SAFETENSORS',
    'portraits/model.safetensors'
  ])('reduces %s to a lowercase file name', (path) => {
    expect(normalizeModelFilename(path)).toBe('model.safetensors');
  });
});

const cdn = 'https://image.civitai.com/xG1n/73328087-0980/original=true';
const image = (url: string, id?: number) => ({
  id,
  url,
  width: 1,
  height: 1
});

describe('civitaiImageId', () => {
  it('prefers the explicit id', () => {
    expect(civitaiImageId(image(`${cdn}/140742447.jpeg`, 7))).toBe(7);
  });

  it('reads a numeric id from the CDN file name', () => {
    expect(civitaiImageId(image(`${cdn}/140742447.jpeg`))).toBe(140742447);
  });

  it('returns null for non-numeric file names', () => {
    expect(civitaiImageId(image(`${cdn}/a84ad265-2ae7.jpeg`))).toBeNull();
  });
});
