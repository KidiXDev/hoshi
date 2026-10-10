import { invoke } from '@tauri-apps/api/core';
import { createPinia, setActivePinia } from 'pinia';
import { describe, expect, it, vi } from 'vitest';
import { shouldPollDownloads, useDownloadStore } from './downloadStore';

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
    expect(invoke).not.toHaveBeenCalled();
  });
});
