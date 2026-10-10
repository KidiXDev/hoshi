import { civitaiSummary, localModel } from '@/test/factories';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODEL_FILTERS,
  collectBaseModels,
  countByCategory,
  filterAndSortModels,
  filterModels,
  hasModelUpdate,
  sortModels,
  type ModelFilters
} from './modelFilters';

const synced = localModel({
  relativeName: 'sub/zeta.safetensors',
  filename: 'zeta.safetensors',
  fileSize: 300,
  modifiedMs: 3,
  previewPath: 'x.png',
  civitai: civitaiSummary({
    latestVersionId: 11,
    modelName: 'Zeta Style',
    versionName: 'v2',
    baseModel: 'Illustrious',
    trainedWords: ['zeta_style'],
    imageCount: 3,
    verified: true
  })
});
const plain = localModel({
  relativeName: 'alpha.safetensors',
  filename: 'alpha.safetensors',
  fileSize: 200,
  modifiedMs: 2
});
const checkpoint = localModel({
  category: 'checkpoints',
  relativeName: 'beta.ckpt',
  filename: 'beta.ckpt',
  extension: 'ckpt',
  fileSize: 100,
  modifiedMs: 5,
  civitai: civitaiSummary({
    modelId: 2,
    versionId: 20,
    latestVersionId: 20,
    modelName: 'Beta',
    modelType: 'Checkpoint',
    baseModel: 'SDXL 1.0'
  })
});
const all = [synced, plain, checkpoint];

const withFilters = (patch: Partial<ModelFilters>) =>
  filterAndSortModels(all, { ...DEFAULT_MODEL_FILTERS, ...patch });

describe('filterAndSortModels', () => {
  it('sorts by name ascending by default', () => {
    expect(withFilters({}).map((model) => model.filename)).toEqual([
      'alpha.safetensors',
      'beta.ckpt',
      'zeta.safetensors'
    ]);
  });

  it('filters by category, sync state, preview and base model', () => {
    expect(withFilters({ category: 'checkpoints' })).toEqual([checkpoint]);
    expect(withFilters({ sync: 'unsynced' })).toEqual([plain, checkpoint]);
    expect(withFilters({ sync: 'synced' })).toEqual([synced]);
    expect(withFilters({ sync: 'update' })).toEqual([synced]);
    expect(withFilters({ preview: 'with' })).toEqual([synced]);
    expect(withFilters({ preview: 'without' })).toHaveLength(2);
    expect(withFilters({ baseModel: 'SDXL 1.0' })).toEqual([checkpoint]);
  });

  it('searches filename, Civitai name and trained words', () => {
    expect(withFilters({ search: 'zeta style' })).toEqual([synced]);
    expect(withFilters({ search: 'ZETA_STYLE' })).toEqual([synced]);
    expect(withFilters({ search: 'beta' })).toEqual([checkpoint]);
    expect(withFilters({ search: 'nothing' })).toEqual([]);
  });

  it('sorts by size and date in the requested direction', () => {
    expect(
      withFilters({ sort: 'size', sortDir: 'desc' }).map(
        (model) => model.fileSize
      )
    ).toEqual([300, 200, 100]);
    expect(
      withFilters({ sort: 'date' }).map((model) => model.modifiedMs)
    ).toEqual([2, 3, 5]);
  });
});

describe('sortModels and filterModels', () => {
  it('filtering keeps a prior sort and neither mutates the input', () => {
    const sorted = sortModels(all, 'size', 'desc');
    expect(all.map((model) => model.filename)).toEqual([
      'zeta.safetensors',
      'alpha.safetensors',
      'beta.ckpt'
    ]);
    const loras = filterModels(sorted, {
      ...DEFAULT_MODEL_FILTERS,
      category: 'loras'
    });
    expect(loras.map((model) => model.fileSize)).toEqual([300, 200]);
  });
});

describe('model helpers', () => {
  it('flags models whose latest Civitai version differs from the installed one', () => {
    expect(hasModelUpdate(synced)).toBe(true);
    expect(hasModelUpdate(checkpoint)).toBe(false);
    expect(hasModelUpdate(plain)).toBe(false);
  });

  it('collects base models and per-category counts', () => {
    expect(collectBaseModels(all)).toEqual(['Illustrious', 'SDXL 1.0']);
    expect(countByCategory(all)).toEqual({ loras: 2, checkpoints: 1 });
  });
});
