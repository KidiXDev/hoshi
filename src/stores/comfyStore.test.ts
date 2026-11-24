import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ComfyApi } from '../services/comfyApi';
import { useComfyStore } from './comfyStore';

vi.mock(import('@tauri-apps/api/core'), async (importOriginal) => ({
  ...(await importOriginal()),
  invoke: vi.fn()
}));

describe('modelPreviewUrl', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('stays stable while previews are unchanged', () => {
    const store = useComfyStore();

    expect(store.modelPreviewUrl('loras', 'a.safetensors')).toBe(
      store.modelPreviewUrl('loras', 'a.safetensors')
    );
  });

  it('changes when previews are invalidated', () => {
    const store = useComfyStore();
    const before = store.modelPreviewUrl('loras', 'a.safetensors');

    store.invalidateModelPreviews();

    expect(store.modelPreviewUrl('loras', 'a.safetensors')).not.toBe(before);
  });

  it('changes after discovery so previews that failed offline retry', async () => {
    vi.spyOn(ComfyApi, 'fetchBridgeModels').mockRejectedValue(new Error());
    vi.spyOn(ComfyApi, 'fetchBridgeSystem').mockRejectedValue(new Error());
    vi.spyOn(ComfyApi, 'fetchObjectInfo').mockRejectedValue(new Error());
    const store = useComfyStore();
    const before = store.modelPreviewUrl('loras', 'a.safetensors');

    await store.fetchDiscovery();

    expect(store.modelPreviewUrl('loras', 'a.safetensors')).not.toBe(before);
  });
});
