import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CivitaiModel, CivitaiVersion } from '../services/civitai';
import type { LocalModel } from '../services/modelManager';
import { useCivitaiStore } from '../stores/civitaiStore';
import { useDownloadStore } from '../stores/downloadStore';
import { civitaiSummary, localModel } from '../test/factories';
import { useInstalledCivitaiVersions } from './useInstalledCivitaiVersions';

const localIndex = await vi.hoisted(async () => {
  const { shallowRef } = await import('vue');
  return shallowRef<{ models: LocalModel[] }>({ models: [] });
});

vi.mock('./useModelManagerQueries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useModelManagerQueries')>()),
  useLocalModelsIndexQuery: () => ({ data: localIndex })
}));

const indexModels = (...models: LocalModel[]) => {
  localIndex.value = { models };
};

const version = (id: number, fileName: string, sha256?: string) =>
  ({
    id,
    name: `v${id}`,
    files: [
      {
        id,
        name: fileName,
        sizeKB: 1,
        type: 'Model',
        hashes: { SHA256: sha256 }
      }
    ],
    images: []
  }) satisfies CivitaiVersion;

const v2 = version(20, 'model_v2.safetensors', 'ABCDEF');
const v1 = version(10, 'model_v1.safetensors');
const model: CivitaiModel = {
  id: 1,
  name: 'Model',
  type: 'LORA',
  nsfw: false,
  modelVersions: [v2, v1]
};

describe('useInstalledCivitaiVersions', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    indexModels();
  });

  it('matches each version through the local file indexed with its version id', () => {
    indexModels(
      localModel({ id: 'a', civitai: civitaiSummary({ versionId: 10 }) }),
      localModel({ id: 'b', civitai: civitaiSummary({ versionId: 20 }) })
    );
    const { isVersionInstalled, installedLocalModel } =
      useInstalledCivitaiVersions();

    expect(isVersionInstalled(model, v1)).toBe(true);
    expect(isVersionInstalled(model, v2)).toBe(true);
    expect(installedLocalModel(model, v2)?.id).toBe('b');
  });

  it('falls back to the file SHA256, case-insensitively', () => {
    indexModels(
      localModel({
        id: 'hash',
        filename: 'other.safetensors',
        sha256: 'abcdef'
      })
    );
    const { isVersionInstalled, installedLocalModel } =
      useInstalledCivitaiVersions();

    expect(installedLocalModel(model, v2)?.id).toBe('hash');
    expect(isVersionInstalled(model, v1)).toBe(false);
  });

  it('falls back to the file name inside the folder for the model type', () => {
    indexModels(
      localModel({
        id: 'wrong-folder',
        category: 'checkpoints',
        filename: 'model_v1.safetensors'
      }),
      localModel({ id: 'file', filename: 'MODEL_V1.safetensors' })
    );
    const { installedLocalModel } = useInstalledCivitaiVersions();

    expect(installedLocalModel(model, v1)?.id).toBe('file');
  });

  it('counts files discovered by the ComfyUI bridge without a local model', () => {
    const civitaiStore = useCivitaiStore();
    const { isVersionInstalled, installedLocalModel } =
      useInstalledCivitaiVersions();

    civitaiStore.localModels = { loras: ['sub/model_v1.safetensors'] };
    expect(isVersionInstalled(model, v1)).toBe(true);
    expect(installedLocalModel(model, v1)).toBeUndefined();

    civitaiStore.localModels = null;
    expect(isVersionInstalled(model, v1)).toBe(false);
  });

  it('counts completed downloads whose file still exists', () => {
    const { isVersionInstalled } = useInstalledCivitaiVersions();

    useDownloadStore().items = [
      {
        gid: 'gid',
        versionId: 10,
        name: 'Model',
        fileName: 'model_v1.safetensors',
        modelType: 'LORA',
        baseModel: '',
        modelPath: '',
        status: 'complete',
        completedLength: 1,
        totalLength: 1,
        downloadSpeed: 0,
        createdAt: 0,
        fileExists: true
      }
    ];

    expect(isVersionInstalled(model, v1)).toBe(true);
  });

  describe('file variants', () => {
    const fp16 = { ...v1.files[0], id: 11, name: 'model_fp16.safetensors' };
    const int8 = { ...v1.files[0], id: 12, name: 'model_int8.safetensors' };
    const variants: CivitaiVersion = { ...v1, files: [fp16, int8] };

    it('marks only the downloaded variant as installed', () => {
      const { isFileInstalled } = useInstalledCivitaiVersions();

      useDownloadStore().items = [
        {
          gid: 'gid',
          versionId: 10,
          name: 'Model',
          fileName: 'model_fp16.safetensors',
          modelType: 'LORA',
          baseModel: '',
          modelPath: '',
          status: 'complete',
          completedLength: 1,
          totalLength: 1,
          downloadSpeed: 0,
          createdAt: 0,
          fileExists: true
        }
      ];

      expect(isFileInstalled(model, variants, fp16)).toBe(true);
      expect(isFileInstalled(model, variants, int8)).toBe(false);
    });

    it('does not credit a version-linked local file to its sibling variant', () => {
      indexModels(
        localModel({
          id: 'fp16',
          filename: 'model_fp16.safetensors',
          civitai: civitaiSummary({ versionId: 10 })
        })
      );
      const { installedLocalModel } = useInstalledCivitaiVersions();

      expect(installedLocalModel(model, variants, fp16)?.id).toBe('fp16');
      expect(installedLocalModel(model, variants, int8)).toBeUndefined();
    });
  });
});
