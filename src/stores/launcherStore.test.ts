import { invoke } from '@tauri-apps/api/core';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAppData } from '../services/appStorage';
import {
  cleanPath,
  parseLauncherArgs,
  useLauncherStore
} from './launcherStore';

vi.mock(import('@tauri-apps/api/core'), async (importOriginal) => ({
  ...(await importOriginal()),
  invoke: vi.fn()
}));

vi.mock(import('../services/appStorage'), async (importOriginal) => ({
  ...(await importOriginal()),
  loadAppData: vi.fn()
}));

describe('useLauncherStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('refuses to start without a ComfyUI folder and never reaches Rust', async () => {
    const launcher = useLauncherStore();
    launcher.config.workingDir = ' " " ';

    await launcher.startServer();

    expect(launcher.hasComfyDirectory).toBe(false);
    expect(launcher.processStatus).toBe('stopped');
    expect(launcher.errorMessage).toContain('ComfyUI folder');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('asks for Python once the folder is configured', () => {
    const launcher = useLauncherStore();
    launcher.config.workingDir = 'configured-folder';
    launcher.config.pythonPath = '';

    expect(launcher.localSetupMessage).toContain('Python executable');
  });

  it('fills the missing profile autocomplete source from defaults', async () => {
    vi.mocked(loadAppData).mockResolvedValue({
      promptAutocompleteSource: { anima: 'word' }
    });
    const launcher = useLauncherStore();

    await launcher.loadConfig();

    expect(launcher.config.promptAutocompleteSource).toEqual({
      anima: 'word',
      moss: 'word'
    });
  });
});

describe('cleanPath', () => {
  it('strips quotes and whitespace and tolerates non-strings', () => {
    expect(cleanPath(' "C:\\ComfyUI" ')).toBe('C:\\ComfyUI');
    expect(cleanPath(null as unknown as string)).toBe('');
  });
});

describe('parseLauncherArgs', () => {
  it('splits arguments and keeps quoted values together', () => {
    expect(parseLauncherArgs('--output-directory "C:\\My Output"')).toEqual([
      '--output-directory',
      'C:\\My Output'
    ]);
  });

  it('tolerates non-strings', () => {
    expect(parseLauncherArgs(null as unknown as string)).toEqual([]);
  });
});
