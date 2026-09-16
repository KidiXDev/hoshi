import { mock, test } from 'bun:test';
import assert from 'node:assert/strict';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';

const indexData = ref();
const queries = await import('./useModelManagerQueries');
mock.module('./useModelManagerQueries', () => ({
  ...queries,
  useLocalModelsIndexQuery: () => ({ data: indexData })
}));

const { useInstalledCivitaiVersions } =
  await import('./useInstalledCivitaiVersions');
const { useCivitaiStore } = await import('../stores/civitaiStore');
const { useDownloadStore } = await import('../stores/downloadStore');

setActivePinia(createPinia());

const local = (overrides) => ({
  id: 'x',
  category: 'loras',
  filename: 'other.safetensors',
  sha256: null,
  civitai: null,
  ...overrides
});
const version = (id, name, sha) => ({
  id,
  name: `v${id}`,
  files: [{ id, name, sizeKB: 1, type: 'Model', hashes: { SHA256: sha } }],
  images: []
});
const model = {
  id: 1,
  name: 'Model',
  type: 'LORA',
  modelVersions: [
    version(20, 'model_v2.safetensors', 'ABCDEF'),
    version(10, 'model_v1.safetensors')
  ]
};
const [v2, v1] = model.modelVersions;

test('version matched through another local file in the index', () => {
  indexData.value = {
    models: [
      local({ id: 'a', civitai: { versionId: 10 } }),
      local({ id: 'b', civitai: { versionId: 20 } })
    ]
  };
  const { isVersionInstalled, installedLocalModel } =
    useInstalledCivitaiVersions();
  assert.equal(isVersionInstalled(model, v1), true);
  assert.equal(isVersionInstalled(model, v2), true);
  assert.equal(installedLocalModel(model, v2)?.id, 'b');
});

test('falls back to sha256, category+filename, discovery, then downloads', () => {
  indexData.value = { models: [local({ id: 'hash', sha256: 'abcdef' })] };
  const { isVersionInstalled, installedLocalModel } =
    useInstalledCivitaiVersions();
  assert.equal(installedLocalModel(model, v2)?.id, 'hash');
  assert.equal(isVersionInstalled(model, v1), false);

  indexData.value = {
    models: [
      local({
        id: 'wrong-folder',
        category: 'checkpoints',
        filename: 'model_v1.safetensors'
      }),
      local({ id: 'file', filename: 'MODEL_V1.safetensors' })
    ]
  };
  assert.equal(installedLocalModel(model, v1)?.id, 'file');

  indexData.value = { models: [] };
  const civitaiStore = useCivitaiStore();
  civitaiStore.localModels = { loras: ['sub/model_v1.safetensors'] };
  assert.equal(isVersionInstalled(model, v1), true);
  assert.equal(installedLocalModel(model, v1), undefined);
  civitaiStore.localModels = null;
  assert.equal(isVersionInstalled(model, v1), false);

  useDownloadStore().items = [
    { versionId: 10, status: 'complete', fileExists: true }
  ];
  assert.equal(isVersionInstalled(model, v1), true);
});
