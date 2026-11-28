import { once } from '@tauri-apps/api/event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { droppedFilePaths, isModelFileName } from './modelManager';

vi.mock(import('@tauri-apps/api/event'), async (importOriginal) => ({
  ...(await importOriginal()),
  once: vi.fn()
}));

describe('isModelFileName', () => {
  it.each([
    'model.safetensors',
    'model.ckpt',
    'model.pt',
    'model.pth',
    'model.bin',
    'model.sft',
    'model.gguf',
    'model.onnx',
    'MODEL.SAFETENSORS'
  ])('accepts %s', (name) => {
    expect(isModelFileName(name)).toBe(true);
  });

  it.each([
    'notes.txt',
    'preview.png',
    'model.safetensors.part',
    'safetensors'
  ])('rejects %s', (name) => {
    expect(isModelFileName(name)).toBe(false);
  });
});

function stubWebview(post = vi.fn()) {
  vi.stubGlobal('window', {
    chrome: { webview: { postMessageWithAdditionalObjects: post } }
  });
  return post;
}

describe('droppedFilePaths', () => {
  const files = [new File(['weights'], 'model.pt')];

  afterEach(() => {
    vi.useRealTimers();
  });

  it('posts a string because the IPC handler stops the chain on anything else', async () => {
    vi.mocked(once).mockImplementation(async (_event, handler) => {
      queueMicrotask(() =>
        handler({ event: 'dropped-file-paths', id: 1, payload: ['C:/a.pt'] })
      );
      return () => {};
    });
    const post = stubWebview();

    await expect(droppedFilePaths(files)).resolves.toEqual(['C:/a.pt']);

    expect(post).toHaveBeenCalledWith(expect.any(String), files);
  });

  it('fails instead of waiting forever when the paths never arrive', async () => {
    vi.useFakeTimers();
    vi.mocked(once).mockResolvedValue(() => {});
    stubWebview();

    const result = expect(droppedFilePaths(files)).rejects.toThrow(
      'dropped file paths'
    );
    await vi.advanceTimersByTimeAsync(10_000);

    await result;
  });

  it('explains when the desktop webview is missing', async () => {
    vi.stubGlobal('window', {});

    await expect(droppedFilePaths(files)).rejects.toThrow('desktop app');
  });
});
