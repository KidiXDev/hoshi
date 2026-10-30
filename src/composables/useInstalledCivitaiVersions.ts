import { computed } from 'vue';
import {
  modelVariantFiles,
  normalizeModelFilename,
  type CivitaiFile,
  type CivitaiModel,
  type CivitaiVersion
} from '../services/civitai';
import type { DownloadRecord } from '../services/downloadManager';
import type { LocalModel } from '../services/modelManager';
import { useCivitaiStore } from '../stores/civitaiStore';
import { useComfyStore } from '../stores/comfyStore';
import { useDownloadStore } from '../stores/downloadStore';
import { useLauncherStore } from '../stores/launcherStore';
import type { BridgeModelsResponse } from '../types/comfy';
import { useLocalModelsIndexQuery } from './useModelManagerQueries';

type BridgeGroup = keyof Omit<BridgeModelsResponse, 'success' | 'error'>;

// Civitai model type → bridge discovery groups + local index categories
const TYPE_FOLDERS: Record<
  string,
  { bridge: BridgeGroup[]; categories: string[] }
> = {
  checkpoint: {
    bridge: ['checkpoints', 'unets'],
    categories: ['checkpoints', 'diffusion_models']
  },
  lora: { bridge: ['loras'], categories: ['loras'] },
  locon: { bridge: ['loras'], categories: ['loras'] },
  dora: { bridge: ['loras'], categories: ['loras'] },
  vae: { bridge: ['vaes'], categories: ['vae'] },
  textualinversion: { bridge: ['embeddings'], categories: ['embeddings'] },
  controlnet: { bridge: ['controlnet'], categories: ['controlnet'] },
  upscaler: { bridge: ['upscale_models'], categories: ['upscale_models'] },
  hypernetwork: { bridge: ['hypernetworks'], categories: ['hypernetworks'] }
};

const NO_FOLDERS: { bridge: BridgeGroup[]; categories: string[] } = {
  bridge: [],
  categories: []
};

function foldersForType(type: string) {
  return TYPE_FOLDERS[type.toLowerCase()] ?? NO_FOLDERS;
}

function isRunningRecord(item: DownloadRecord) {
  return ['active', 'waiting', 'paused'].includes(item.status);
}

function isDownloadedRecord(item: DownloadRecord) {
  return item.status === 'complete' && item.fileExists !== false;
}

export function useInstalledCivitaiVersions() {
  const comfyStore = useComfyStore();
  const launcherStore = useLauncherStore();
  const downloadStore = useDownloadStore();
  const civitaiStore = useCivitaiStore();
  const indexQuery = useLocalModelsIndexQuery();

  const progress = computed<Record<number, DownloadRecord>>(() =>
    Object.fromEntries(
      downloadStore.items
        .filter(isRunningRecord)
        .map((item) => [item.versionId, item])
    )
  );

  const downloaded = computed<Record<number, DownloadRecord>>(() =>
    Object.fromEntries(
      downloadStore.items
        .filter(isDownloadedRecord)
        .map((item) => [item.versionId, item])
    )
  );

  function fileRecord(
    version: CivitaiVersion,
    file: CivitaiFile,
    matches: (item: DownloadRecord) => boolean
  ) {
    const name = normalizeModelFilename(file.name);
    return downloadStore.items.find(
      (item) =>
        item.versionId === version.id &&
        normalizeModelFilename(item.fileName) === name &&
        matches(item)
    );
  }

  function fileProgress(version: CivitaiVersion, file: CivitaiFile) {
    return fileRecord(version, file, isRunningRecord);
  }

  function fileDownloaded(version: CivitaiVersion, file: CivitaiFile) {
    return fileRecord(version, file, isDownloadedRecord);
  }

  const indexedModels = computed(() => indexQuery.data.value?.models ?? []);

  const indexedByVersionId = computed(
    () =>
      new Map(
        indexedModels.value.flatMap((local) =>
          local.civitai?.versionId ? [[local.civitai.versionId, local]] : []
        )
      )
  );

  const indexedBySha256 = computed(
    () =>
      new Map(
        indexedModels.value.flatMap((local) =>
          local.sha256 ? [[local.sha256.toLowerCase(), local]] : []
        )
      )
  );

  const indexedByCategoryFile = computed(
    () =>
      new Map(
        indexedModels.value.map((local) => [
          `${local.category}/${normalizeModelFilename(local.filename)}`,
          local
        ])
      )
  );

  const bridgeFileNames = computed(() => {
    const bridge =
      civitaiStore.localModels ??
      (launcherStore.hasComfyDirectory ? comfyStore.bridgeModels : null);
    return Object.fromEntries(
      Object.entries(TYPE_FOLDERS).map(([type, { bridge: groups }]) => [
        type,
        new Set(
          groups
            .flatMap((group) => bridge?.[group] ?? [])
            .map((name) => normalizeModelFilename(name))
        )
      ])
    );
  });

  function installedLocalModel(
    model?: CivitaiModel | null,
    version?: CivitaiVersion,
    file?: CivitaiFile
  ): LocalModel | undefined {
    if (!model || !version) return;
    const { categories } = foldersForType(model.type);
    const files = file ? [file] : version.files;
    const byVersion =
      file && modelVariantFiles(version).length > 1
        ? undefined
        : indexedByVersionId.value.get(version.id);
    return (
      byVersion ??
      files
        .map((candidate) =>
          indexedBySha256.value.get(
            candidate.hashes?.SHA256?.toLowerCase() ?? ''
          )
        )
        .find(Boolean) ??
      categories
        .flatMap((category) =>
          files.map((candidate) =>
            indexedByCategoryFile.value.get(
              `${category}/${normalizeModelFilename(candidate.name)}`
            )
          )
        )
        .find(Boolean)
    );
  }

  function isFileInstalled(
    model: CivitaiModel,
    version: CivitaiVersion,
    file: CivitaiFile
  ) {
    return (
      !!fileDownloaded(version, file) ||
      !!installedLocalModel(model, version, file) ||
      !!bridgeFileNames.value[model.type.toLowerCase()]?.has(
        normalizeModelFilename(file.name)
      )
    );
  }

  function isVersionInstalled(
    model?: CivitaiModel | null,
    version?: CivitaiVersion
  ) {
    if (!model || !version) return false;
    if (downloaded.value[version.id] || installedLocalModel(model, version))
      return true;
    const discovered = bridgeFileNames.value[model.type.toLowerCase()];
    return (
      !!discovered &&
      version.files.some((file) =>
        discovered.has(normalizeModelFilename(file.name))
      )
    );
  }

  return {
    progress,
    downloaded,
    fileProgress,
    fileDownloaded,
    installedLocalModel,
    isVersionInstalled,
    isFileInstalled
  };
}
