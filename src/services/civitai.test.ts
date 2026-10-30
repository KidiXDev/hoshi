import { describe, expect, it } from 'vitest';
import {
  civitaiImageId,
  civitaiModelLink,
  civitaiPreviewUrl,
  getComfyTargetFolder,
  modelVariantFiles,
  normalizeModelFilename,
  type CivitaiFile
} from './civitai';

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

describe('civitaiModelLink', () => {
  it.each([
    ['https://civitai.com/models/123', { modelId: 123, versionId: null }],
    [
      'https://www.civitai.com/models/123/some-slug?modelVersionId=456',
      { modelId: 123, versionId: 456 }
    ],
    ['https://civitai.red/models/789', { modelId: 789, versionId: null }]
  ])('reads %s', (href, expected) => {
    expect(civitaiModelLink(new URL(href))).toEqual(expected);
  });

  it.each([
    'https://civitai.com/images/123',
    'https://civitai.com/models/abc',
    'https://example.com/models/123'
  ])('ignores %s', (href) => {
    expect(civitaiModelLink(new URL(href))).toBeNull();
  });
});

const file = (id: number, type: string, primary = false): CivitaiFile => ({
  id,
  name: `file-${id}`,
  sizeKB: 1,
  type,
  primary
});
const versionWith = (...files: CivitaiFile[]) => ({
  id: 1,
  name: 'v1',
  files,
  images: []
});

describe('modelVariantFiles', () => {
  it('keeps model files only, primary first', () => {
    const files = modelVariantFiles(
      versionWith(
        file(1, 'Model'),
        file(2, 'Training Data'),
        file(3, 'Pruned Model', true)
      )
    );
    expect(files.map(({ id }) => id)).toEqual([3, 1]);
  });

  it('falls back to the primary file when no file is a model', () => {
    const files = modelVariantFiles(
      versionWith(file(1, 'Archive'), file(2, 'Archive', true))
    );
    expect(files.map(({ id }) => id)).toEqual([2]);
  });
});

describe('civitaiPreviewUrl', () => {
  it('requests a resized copy of an original CDN image', () => {
    expect(civitaiPreviewUrl(`${cdn}/1.jpeg`, 450)).toBe(
      'https://image.civitai.com/xG1n/73328087-0980/width=450/1.jpeg'
    );
  });
});

describe('getComfyTargetFolder', () => {
  it('sends MOSS Image checkpoints to diffusion_models', () => {
    expect(getComfyTargetFolder('Checkpoint', 'MOSS Image')).toBe(
      'models/diffusion_models'
    );
  });
});
