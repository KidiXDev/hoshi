import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

/** Mirrors `model_manager::CivitaiSummary` (Rust). */
export interface CivitaiSummary {
  modelId: number | null;
  versionId: number | null;
  modelName: string;
  versionName: string;
  modelType: string;
  baseModel: string;
  trainedWords: string[];
  nsfw: boolean;
  imageCount: number;
  latestVersionId: number | null;
  /** Hash confirmed against Civitai; `false` = metadata only from a sidecar. */
  verified: boolean;
}

export function isVerified(model: LocalModel): boolean {
  return Boolean(model.civitai?.verified);
}

/** Mirrors `model_manager::LocalModel` (Rust). */
export interface LocalModel {
  id: string;
  /** ComfyUI folder category, e.g. `loras`, `checkpoints`, `diffusion_models`. */
  category: string;
  /** Path relative to the category root with `/` separators, as ComfyUI lists it. */
  relativeName: string;
  filename: string;
  path: string;
  root: string;
  extension: string;
  fileSize: number;
  modifiedMs: number;
  sha256: string | null;
  hashSize: number | null;
  hashModifiedMs: number | null;
  previewPath: string | null;
  /** Modified time of the preview file; used to cache-bust preview URLs. */
  previewModifiedMs: number | null;
  sidecar: string | null;
  civitai: CivitaiSummary | null;
  syncAttemptedMs: number;
}

export interface CategoryRoot {
  category: string;
  path: string;
  isDefault: boolean;
}

export interface LocalModelsIndex {
  comfyRoot: string;
  roots: CategoryRoot[];
  models: LocalModel[];
  warnings: string[];
  scannedAtMs: number;
}

export interface ModelHeaderInfo {
  metadata: Record<string, string>;
  suggestedWords: string[];
  baseModel: string | null;
}

export interface ModelIndexProgress {
  stage: 'scanning' | 'indexing' | 'done';
  processed: number;
  total: number;
}

export interface ModelHashProgress {
  id: string;
  processed: number;
  total: number;
}

export interface ModelSyncProgress {
  stage: 'syncing' | 'done';
  processed: number;
  total: number;
  current: string;
  error: string | null;
}

export interface SyncAllResult {
  synced: number;
  failed: number;
  skipped: number;
  cancelled: boolean;
  error: string | null;
}

export type PreviewSource =
  { kind: 'url'; url: string } | { kind: 'localPath'; path: string };

/** Error sentinel returned by the Rust side when Civitai has no record of a hash. */
export const CIVITAI_NOT_FOUND = 'NOT_FOUND';

export function isCivitaiNotFound(error: unknown): boolean {
  return String(error) === CIVITAI_NOT_FOUND;
}

export function listLocalModelsIndex(workingDir: string, args: string[]) {
  return invoke<LocalModelsIndex>('list_local_models_index', {
    workingDir,
    args
  });
}

export function rescanModels(workingDir: string, args: string[]) {
  return invoke<LocalModelsIndex>('rescan_models', { workingDir, args });
}

export function findLocalModel(
  workingDir: string,
  args: string[],
  category: string,
  relativeName: string
) {
  return invoke<LocalModel | null>('find_local_model', {
    workingDir,
    args,
    category,
    relativeName
  });
}

export function readModelMetadata(id: string) {
  return invoke<ModelHeaderInfo>('read_model_metadata', { id });
}

export function readModelSidecar(id: string) {
  return invoke<Record<string, unknown> | null>('read_model_sidecar', { id });
}

export function hashModel(id: string) {
  return invoke<string>('hash_model', { id });
}

export function syncModelWithCivitai(id: string, apiKey = '') {
  return invoke<LocalModel>('sync_model_with_civitai', { id, apiKey });
}

export function syncAllModels(
  workingDir: string,
  args: string[],
  apiKey = '',
  onlyUnsynced = true
) {
  return invoke<SyncAllResult>('sync_all_models', {
    workingDir,
    args,
    apiKey,
    onlyUnsynced
  });
}

export function cancelModelSync() {
  return invoke<void>('cancel_model_sync');
}

export function checkModelUpdate(id: string, apiKey = '') {
  return invoke<number | null>('check_model_update', { id, apiKey });
}

export function deleteModel(id: string) {
  return invoke<string[]>('delete_model', { id });
}

export function setModelPreview(id: string, source: PreviewSource) {
  return invoke<LocalModel>('set_model_preview', { id, source });
}

export function showModelInFolder(path: string) {
  return invoke<void>('show_in_folder', { path });
}

/**
 * URL served by the `comfygui-model` scheme (thumbnail or full preview). The
 * preview's mtime is appended so a replaced preview is not served from the
 * browser cache under the same URL.
 */
export function modelPreviewUrl(
  model: Pick<LocalModel, 'id' | 'previewModifiedMs'>,
  thumbnail = true
): string {
  const kind = thumbnail ? 'thumb' : 'full';
  const base = navigator.userAgent.includes('Windows')
    ? `http://comfygui-model.localhost/${kind}/${model.id}`
    : `comfygui-model://localhost/${kind}/${model.id}`;
  return model.previewModifiedMs
    ? `${base}?v=${model.previewModifiedMs}`
    : base;
}

export function onModelIndexProgress(
  handler: (progress: ModelIndexProgress) => void
): Promise<UnlistenFn> {
  return listen<ModelIndexProgress>('model-index-progress', (event) =>
    handler(event.payload)
  );
}

export function onModelHashProgress(
  handler: (progress: ModelHashProgress) => void
): Promise<UnlistenFn> {
  return listen<ModelHashProgress>('model-hash-progress', (event) =>
    handler(event.payload)
  );
}

export function onModelSyncProgress(
  handler: (progress: ModelSyncProgress) => void
): Promise<UnlistenFn> {
  return listen<ModelSyncProgress>('model-sync-progress', (event) =>
    handler(event.payload)
  );
}

/** Human-readable label for a ComfyUI model category. */
export const MODEL_CATEGORY_LABELS: Record<string, string> = {
  checkpoints: 'Checkpoints',
  diffusion_models: 'Diffusion Models',
  loras: 'LoRAs',
  vae: 'VAE',
  text_encoders: 'Text Encoders',
  clip_vision: 'CLIP Vision',
  controlnet: 'ControlNet',
  upscale_models: 'Upscalers',
  embeddings: 'Embeddings',
  hypernetworks: 'Hypernetworks',
  style_models: 'Style Models',
  gligen: 'GLIGEN',
  photomaker: 'PhotoMaker',
  vae_approx: 'VAE Approx',
  audio_encoders: 'Audio Encoders',
  model_patches: 'Model Patches'
};

export function modelCategoryLabel(category: string): string {
  return (
    MODEL_CATEGORY_LABELS[category] ??
    category.replaceAll('_', ' ').replaceAll(/\b\w/gu, (c) => c.toUpperCase())
  );
}

/** Native file picker limited to preview-capable image formats. */
export function pickPreviewImageFile(defaultPath?: string) {
  return invoke<string | null>('pick_file', {
    title: 'Select Preview Image',
    defaultPath,
    filterName: 'Images',
    filterExtensions: ['png', 'jpg', 'jpeg', 'webp', 'gif']
  });
}
