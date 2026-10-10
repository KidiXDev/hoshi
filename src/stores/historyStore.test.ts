import { invoke } from '@tauri-apps/api/core';
import { flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { loadAppData, saveAppData } from '../services/appStorage';
import { deferred } from '../test/deferred';
import { useHistoryStore } from './historyStore';
import { useLauncherStore } from './launcherStore';

vi.mock(import('@tauri-apps/api/core'), async (importOriginal) => ({
  ...(await importOriginal()),
  invoke: vi.fn()
}));

vi.mock(import('../services/appStorage'), () => ({
  loadAppData: vi.fn(),
  saveAppData: vi.fn(async () => {}),
  deleteAppData: vi.fn(async () => {})
}));

async function loadedHistory() {
  const history = useHistoryStore();
  await flushPromises();
  return history;
}

describe('useHistoryStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(loadAppData).mockResolvedValue([
      {
        id: 'image-1',
        filename: 'face.png',
        subfolder: '',
        type: 'output',
        imageUrl: 'http://koharu-image.localhost/full/history-old'
      }
    ]);
  });

  it('hides restored local images until Rust registers them again', async () => {
    const registration = deferred<Record<string, string>>();
    vi.mocked(invoke).mockReturnValue(registration.promise);
    const history = await loadedHistory();
    expect(history.items[0]?.imageUrl).toBe('');

    useLauncherStore().config.workingDir = 'configured-comfy';
    await nextTick();
    expect(invoke).toHaveBeenCalledWith(
      'resolve_history_images',
      expect.objectContaining({ workingDir: 'configured-comfy' })
    );
    expect(history.items[0]?.imageUrl).toBe('');

    registration.resolve({ 'image-1': 'history-old' });
    await flushPromises();
    expect(history.items[0]?.imageUrl).toMatch(/history-old\?session=\d+$/u);
  });

  it('removes a single item and persists the remaining list', async () => {
    const history = await loadedHistory();

    history.removeHistory('image-1');

    expect(history.items).toEqual([]);
    expect(saveAppData).toHaveBeenLastCalledWith('session_history', []);
  });
});
