import { invoke } from '@tauri-apps/api/core';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCivitaiStore } from './civitaiStore';
import { useLauncherStore } from './launcherStore';

vi.mock(import('@tauri-apps/api/core'), async (importOriginal) => ({
  ...(await importOriginal()),
  invoke: vi.fn()
}));

describe('useCivitaiStore.refreshLocalModels', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it.each([
    ['no ComfyUI folder', { workingDir: '', pythonPath: '' }],
    ['no Python', { workingDir: 'configured-folder', pythonPath: '' }]
  ])('skips discovery quietly with %s', async (_, paths) => {
    Object.assign(useLauncherStore().config, paths);
    const civitai = useCivitaiStore();

    await civitai.refreshLocalModels();

    expect(civitai.localModels).toBeNull();
    expect(civitai.discoveryError).toBe('');
    expect(invoke).not.toHaveBeenCalled();
  });
});
