import { invoke } from '@tauri-apps/api/core';
import { createPinia, setActivePinia } from 'pinia';
import { describe, expect, it, vi } from 'vitest';
import type { DownloadRecord } from '../services/downloadManager';
import { useCivitaiStore } from './civitaiStore';
import { useComfyStore } from './comfyStore';
import { shouldPollDownloads, useDownloadStore } from './downloadStore';
import { useLauncherStore } from './launcherStore';

vi.mock(import('@tauri-apps/api/core'), async (importOriginal) => ({
  ...(await importOriginal()),
  invoke: vi.fn()
}));

describe('shouldPollDownloads', () => {
  it.each([
    ['active', true],
    ['waiting', true],
    ['paused', false],
    ['complete', false]
  ] as const)('%s → %s', (status, expected) => {
    expect(shouldPollDownloads([{ status }])).toBe(expected);
  });

  it('does not poll an empty list', () => {
    expect(shouldPollDownloads([])).toBe(false);
  });
});

describe('useDownloadStore.enqueueCivitai', () => {
  it('rejects without a ComfyUI folder before reaching Rust', async () => {
    setActivePinia(createPinia());

    await expect(
      useDownloadStore().enqueueCivitai({
        workingDir: '',
        versionId: 1,
        apiKey: ''
      })
    ).rejects.toThrow('ComfyUI folder');
    expect(invoke).not.toHaveBeenCalledWith('download', expect.anything());
  });
});

describe('useDownloadStore.refresh', () => {
  it('refreshes the ComfyUI model lists when a download finishes', async () => {
    setActivePinia(createPinia());
    useLauncherStore().config.workingDir = 'F:/ComfyUI';
    const comfyStore = useComfyStore();
    comfyStore.isConnected = true;
    const refreshModels = vi
      .spyOn(comfyStore, 'refreshModels')
      .mockResolvedValue();
    vi.spyOn(useCivitaiStore(), 'refreshLocalModels').mockResolvedValue();
    const store = useDownloadStore();
    const record = { gid: '0-1', status: 'active' } as DownloadRecord;
    store.items = [record];
    vi.mocked(invoke).mockResolvedValue([{ ...record, status: 'complete' }]);

    await store.refresh();

    expect(refreshModels).toHaveBeenCalledOnce();
  });
});

describe('useDownloadStore.enqueueUrl', () => {
  const download = {
    url: 'https://huggingface.co/org/repo/resolve/main/model.safetensors',
    category: 'diffusion_models',
    fileName: 'model.safetensors'
  };

  it('rejects without a ComfyUI folder before reaching Rust', async () => {
    setActivePinia(createPinia());
    useLauncherStore().config.workingDir = '';

    await expect(useDownloadStore().enqueueUrl(download)).rejects.toThrow(
      'ComfyUI folder'
    );
    expect(invoke).not.toHaveBeenCalledWith('download_url', expect.anything());
  });

  it('queues the link with the launcher paths and tracks the record', async () => {
    setActivePinia(createPinia());
    const launcherStore = useLauncherStore();
    launcherStore.config.workingDir = '"F:/ComfyUI"';
    launcherStore.config.args = '--port 8188';
    const record = { gid: '0-1', status: 'complete' };
    vi.mocked(invoke).mockResolvedValue(record);
    const store = useDownloadStore();

    await store.enqueueUrl(download);

    expect(invoke).toHaveBeenCalledWith('download_url', {
      ...download,
      workingDir: 'F:/ComfyUI',
      args: ['--port', '8188']
    });
    expect(store.items).toEqual([record]);
  });
});
