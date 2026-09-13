import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_MODEL_FILTERS,
  collectBaseModels,
  countByCategory,
  filterAndSortModels,
  filterModels,
  hasModelUpdate,
  sortModels
} from './modelFilters';

function model(overrides) {
  return {
    id: overrides.id ?? overrides.relativeName,
    category: 'loras',
    relativeName: 'a.safetensors',
    filename: 'a.safetensors',
    path: 'C:/models/loras/a.safetensors',
    root: 'C:/models/loras',
    extension: 'safetensors',
    fileSize: 10,
    modifiedMs: 1,
    sha256: null,
    hashSize: null,
    hashModifiedMs: null,
    previewPath: null,
    sidecar: null,
    civitai: null,
    syncAttemptedMs: 0,
    ...overrides
  };
}

const synced = model({
  relativeName: 'sub/zeta.safetensors',
  filename: 'zeta.safetensors',
  fileSize: 300,
  modifiedMs: 3,
  previewPath: 'x.png',
  civitai: {
    modelId: 1,
    versionId: 10,
    latestVersionId: 11,
    modelName: 'Zeta Style',
    versionName: 'v2',
    modelType: 'LORA',
    baseModel: 'Illustrious',
    trainedWords: ['zeta_style'],
    nsfw: false,
    imageCount: 3,
    verified: true
  }
});
const plain = model({
  relativeName: 'alpha.safetensors',
  filename: 'alpha.safetensors',
  fileSize: 200,
  modifiedMs: 2
});
const checkpoint = model({
  category: 'checkpoints',
  relativeName: 'beta.ckpt',
  filename: 'beta.ckpt',
  extension: 'ckpt',
  fileSize: 100,
  modifiedMs: 5,
  civitai: {
    modelId: 2,
    versionId: 20,
    latestVersionId: 20,
    modelName: 'Beta',
    versionName: 'v1',
    modelType: 'Checkpoint',
    baseModel: 'SDXL 1.0',
    trainedWords: [],
    nsfw: false,
    imageCount: 0,
    verified: false
  }
});
const all = [synced, plain, checkpoint];

describe('modelFilters', () => {
  test('sorts by name ascending by default', () => {
    expect(
      filterAndSortModels(all, DEFAULT_MODEL_FILTERS).map((m) => m.filename)
    ).toEqual(['alpha.safetensors', 'beta.ckpt', 'zeta.safetensors']);
  });

  test('filters by category, sync state, preview and base model', () => {
    const f = (patch) =>
      filterAndSortModels(all, { ...DEFAULT_MODEL_FILTERS, ...patch });
    expect(f({ category: 'checkpoints' })).toEqual([checkpoint]);
    // `checkpoint` has sidecar metadata but its hash was never verified.
    expect(f({ sync: 'unsynced' })).toEqual([plain, checkpoint]);
    expect(f({ sync: 'synced' })).toEqual([synced]);
    expect(f({ sync: 'update' })).toEqual([synced]);
    expect(f({ preview: 'with' })).toEqual([synced]);
    expect(f({ preview: 'without' }).length).toBe(2);
    expect(f({ baseModel: 'SDXL 1.0' })).toEqual([checkpoint]);
  });

  test('search matches filename, civitai name and trained words', () => {
    const f = (search) =>
      filterAndSortModels(all, { ...DEFAULT_MODEL_FILTERS, search });
    expect(f('zeta style')).toEqual([synced]);
    expect(f('ZETA_STYLE')).toEqual([synced]);
    expect(f('beta')).toEqual([checkpoint]);
    expect(f('nothing')).toEqual([]);
  });

  test('sorts by size and date with direction', () => {
    const bySize = filterAndSortModels(all, {
      ...DEFAULT_MODEL_FILTERS,
      sort: 'size',
      sortDir: 'desc'
    });
    expect(bySize.map((m) => m.fileSize)).toEqual([300, 200, 100]);
    const byDate = filterAndSortModels(all, {
      ...DEFAULT_MODEL_FILTERS,
      sort: 'date'
    });
    expect(byDate.map((m) => m.modifiedMs)).toEqual([2, 3, 5]);
  });

  test('helpers', () => {
    expect(hasModelUpdate(synced)).toBe(true);
    expect(hasModelUpdate(checkpoint)).toBe(false);
    expect(hasModelUpdate(plain)).toBe(false);
    expect(collectBaseModels(all)).toEqual(['Illustrious', 'SDXL 1.0']);
    expect(countByCategory(all)).toEqual({ loras: 2, checkpoints: 1 });
  });
});

describe('sortModels / filterModels split', () => {
  test('filtering preserves a prior sort and does not mutate input', () => {
    const sorted = sortModels(all, 'size', 'desc');
    expect(all.map((m) => m.filename)).toEqual([
      'zeta.safetensors',
      'alpha.safetensors',
      'beta.ckpt'
    ]);
    const filtered = filterModels(sorted, {
      ...DEFAULT_MODEL_FILTERS,
      category: 'loras'
    });
    expect(filtered.map((m) => m.fileSize)).toEqual([300, 200]);
  });
});
