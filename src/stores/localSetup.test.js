import { expect, test } from 'bun:test';
import { createPinia, setActivePinia } from 'pinia';
import { useCivitaiStore } from './civitaiStore';
import { useDownloadStore } from './downloadStore';
import {
  cleanPath,
  parseLauncherArgs,
  useLauncherStore
} from './launcherStore';

test('unconfigured local features stop before native calls', async () => {
  setActivePinia(createPinia());
  const launcher = useLauncherStore();
  launcher.config.workingDir = ' " " ';
  expect(launcher.hasComfyDirectory).toBe(false);
  await launcher.startServer();
  expect(launcher.processStatus).toBe('stopped');
  expect(launcher.errorMessage).toContain('ComfyUI folder');
  const civitai = useCivitaiStore();
  await civitai.refreshLocalModels();
  expect(civitai.localModels).toBeNull();
  expect(civitai.discoveryError).toBe('');
  await expect(
    useDownloadStore().enqueueCivitai({
      workingDir: '',
      versionId: 1,
      apiKey: ''
    })
  ).rejects.toThrow('ComfyUI folder');
  launcher.config.workingDir = 'configured-folder';
  launcher.config.pythonPath = '';
  expect(launcher.localSetupMessage).toContain('Python executable');
  await civitai.refreshLocalModels();
  expect(civitai.discoveryError).toBe('');
  expect(cleanPath(null)).toBe('');
  expect(parseLauncherArgs(null)).toEqual([]);
  expect(parseLauncherArgs('--output-directory "C:\\My Output"')).toEqual([
    '--output-directory',
    'C:\\My Output'
  ]);
});
