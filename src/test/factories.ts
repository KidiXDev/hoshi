import type { CivitaiSummary, LocalModel } from '@/services/modelManager';

export function civitaiSummary(
  overrides: Partial<CivitaiSummary> = {}
): CivitaiSummary {
  return {
    modelId: 1,
    versionId: 10,
    latestVersionId: 10,
    modelName: '',
    versionName: 'v1',
    modelType: 'LORA',
    baseModel: '',
    trainedWords: [],
    nsfw: false,
    imageCount: 0,
    verified: false,
    ...overrides
  };
}

export function localModel(overrides: Partial<LocalModel> = {}): LocalModel {
  return {
    id: overrides.id ?? overrides.relativeName ?? 'a.safetensors',
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
    previewModifiedMs: null,
    sidecar: null,
    civitai: null,
    syncAttemptedMs: 0,
    ...overrides
  };
}
