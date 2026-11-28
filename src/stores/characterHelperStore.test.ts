import { flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelCharacterDatasetRebuild,
  getCharacterDatasetStatus,
  getCharacterFields,
  getCharacterPreset,
  randomizeCharacterFields,
  rebuildCharacterDataset,
  type CharacterDatasetStatus,
  type CharacterField,
  type RebuildListeners,
  type RebuildProgress,
  type RebuildSummary
} from '../services/characterData';
import { deferred } from '../test/deferred';
import { useCharacterHelperStore } from './characterHelperStore';
import { useWorkflowStore } from './workflowStore';

const listeners = vi.hoisted(() => ({
  current: null as RebuildListeners | null,
  stop: (() => {}) as () => void
}));

vi.mock(import('../services/characterData'), async (importOriginal) => ({
  ...(await importOriginal()),
  getCharacterDatasetStatus: vi.fn(),
  getCharacterFields: vi.fn(),
  getCharacterPreset: vi.fn(),
  randomizeCharacterFields: vi.fn(),
  rebuildCharacterDataset: vi.fn(),
  cancelCharacterDatasetRebuild: vi.fn(),
  listenToCharacterDatasetRebuild: vi.fn(async (handlers) => {
    listeners.current = handlers;
    return listeners.stop;
  })
}));

const REBUILD_REQUEST = {
  workingDir: 'D:/ComfyUI',
  pythonPath: 'python_embeded',
  downloadDir: 'D:/Temp'
};
const SUMMARY: RebuildSummary = {
  tags: 17_000,
  characters: 39_000,
  posts: 160_000,
  seconds: 720
};
const PROGRESS: RebuildProgress = {
  step: 2,
  steps: 4,
  label: 'Downloading posts.parquet (1 of 10)',
  done: 1_000,
  total: 4_000,
  unit: 'bytes'
};

vi.mock(import('../services/appStorage'), () => ({
  loadAppData: vi.fn(async () => null),
  saveAppData: vi.fn(async () => {}),
  deleteAppData: vi.fn(async () => {})
}));

const field = (id: string, count = 2): CharacterField => ({
  id,
  label: id,
  count,
  group: 'looks'
});

const datasetStatus = (installed: boolean): CharacterDatasetStatus => ({
  installed,
  built: installed ? '2026-11-23' : null,
  loadError: null,
  configDir: 'C:/config/character_helper',
  defaultDownloadDir: 'C:/Temp',
  rebuilding: false
});

async function loadedStore() {
  vi.mocked(getCharacterFields).mockResolvedValue([
    field('character', 1),
    field('subject'),
    field('hair', 3),
    field('top')
  ]);
  const store = useCharacterHelperStore();
  await store.load();
  return store;
}

describe('useCharacterHelperStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    listeners.current = null;
    listeners.stop = vi.fn();
    vi.mocked(getCharacterDatasetStatus).mockResolvedValue(datasetStatus(true));
  });

  it('reports a missing dataset without asking for fields', async () => {
    vi.mocked(getCharacterDatasetStatus).mockResolvedValue(
      datasetStatus(false)
    );
    const store = useCharacterHelperStore();

    await store.load();

    expect(store.datasetInstalled).toBe(false);
    expect(store.fieldIds).toEqual([]);
    expect(getCharacterFields).not.toHaveBeenCalled();
  });

  it('starts every field empty with the default dice count', async () => {
    const store = await loadedStore();

    expect(store.fields).toEqual({
      character: [],
      subject: [],
      hair: [],
      top: []
    });
    expect(store.counts).toEqual({ character: 1, subject: 2, hair: 3, top: 2 });
  });

  it('adds the series and locks the character when one is picked', async () => {
    const store = await loadedStore();

    store.setCharacter('hatsune_miku', 'vocaloid');

    expect(store.fields.character).toEqual(['hatsune_miku', 'vocaloid']);
    expect(store.isLocked('character')).toBe(true);
  });

  it('fills unlocked fields with the usual look', async () => {
    const store = await loadedStore();
    store.setCharacter('hatsune_miku');
    store.setField('top', ['hoodie']);
    store.toggleLock('top');
    vi.mocked(getCharacterPreset).mockResolvedValue({
      character: 'hatsune_miku',
      series: 'vocaloid',
      count: 10,
      fields: {
        subject: ['1girl'],
        hair: ['twintails'],
        top: ['detached_sleeves']
      }
    });

    await store.usualLook();

    expect(store.fields.hair).toEqual(['twintails']);
    expect(store.fields.top).toEqual(['hoodie']);
  });

  it('rejects the usual look without a character', async () => {
    const store = await loadedStore();

    await expect(store.usualLook()).rejects.toThrow('Pick a character');
  });

  it('rolls only unlocked fields and sends the current state', async () => {
    const store = await loadedStore();
    store.setCharacter('hatsune_miku');
    store.mustInclude = ['school_uniform'];
    vi.mocked(randomizeCharacterFields).mockResolvedValue({
      hair: ['bob_cut']
    });

    await store.roll();

    expect(randomizeCharacterFields).toHaveBeenCalledWith({
      fields: ['subject', 'hair', 'top'],
      counts: store.counts,
      context: expect.objectContaining({ character: ['hatsune_miku'] }),
      rating: 'sensitive',
      require: ['school_uniform']
    });
    expect(store.fields.hair).toEqual(['bob_cut']);
  });

  it('undoes the last roll', async () => {
    const store = await loadedStore();
    store.setField('hair', ['long_hair']);
    vi.mocked(randomizeCharacterFields).mockResolvedValue({
      hair: ['bob_cut']
    });
    await store.roll(['hair']);

    store.undo();

    expect(store.fields.hair).toEqual(['long_hair']);
  });

  it('clears only unlocked fields', async () => {
    const store = await loadedStore();
    store.setCharacter('hatsune_miku');
    store.setField('hair', ['long_hair']);

    store.clearUnlocked();

    expect(store.fields.character).toEqual(['hatsune_miku']);
    expect(store.fields.hair).toEqual([]);
  });

  it('appends the built tags to the positive prompt without duplicates', async () => {
    const store = await loadedStore();
    const workflow = useWorkflowStore();
    workflow.positivePrompt = 'masterpiece, long hair';
    store.setField('hair', ['long_hair', 'blue_hair']);

    store.sendToPrompt('append');

    expect(workflow.positivePrompt).toBe('masterpiece, long hair, blue hair');
  });

  it('reloads the fields after a dataset rebuild and keeps edited tags', async () => {
    const store = await loadedStore();
    store.setField('hair', ['long_hair']);
    store.toggleLock('top');
    const rebuild = deferred<RebuildSummary | null>();
    vi.mocked(rebuildCharacterDataset).mockReturnValue(rebuild.promise);
    vi.mocked(getCharacterFields).mockResolvedValue([
      field('hair', 3),
      field('pose', 1)
    ]);

    const done = store.rebuildDataset(REBUILD_REQUEST);
    await flushPromises();
    expect(store.rebuilding).toBe(true);
    rebuild.resolve(SUMMARY);
    await done;

    expect(store.rebuilding).toBe(false);
    expect(store.fieldIds).toEqual(['hair', 'pose']);
    expect(store.fields).toEqual({ hair: ['long_hair'], pose: [] });
    expect(store.locks).toEqual([]);
    expect(store.rebuildOutcome).toEqual({ ok: true, summary: SUMMARY });
  });

  it('tracks progress and warnings while rebuilding, then stops listening', async () => {
    const store = await loadedStore();
    const rebuild = deferred<RebuildSummary | null>();
    vi.mocked(rebuildCharacterDataset).mockReturnValue(rebuild.promise);

    const done = store.rebuildDataset(REBUILD_REQUEST);
    await flushPromises();
    listeners.current?.progress(PROGRESS);
    listeners.current?.warning('Low RAM');
    listeners.current?.warning('Low RAM');

    expect(store.rebuildProgress).toEqual(PROGRESS);
    expect(store.rebuildWarnings).toEqual(['Low RAM']);
    rebuild.resolve(null);
    await done;
    expect(store.rebuildProgress).toBeNull();
    expect(listeners.stop).toHaveBeenCalledOnce();
  });

  it('keeps the failure message and clears the rebuilding flag', async () => {
    const store = await loadedStore();
    vi.mocked(rebuildCharacterDataset).mockRejectedValue('Disk is full');

    await expect(store.rebuildDataset(REBUILD_REQUEST)).rejects.toBe(
      'Disk is full'
    );

    expect(store.rebuilding).toBe(false);
    expect(store.rebuildOutcome).toEqual({
      ok: false,
      stopped: false,
      message: 'Disk is full'
    });
  });

  it('marks a rebuild the user stopped as stopped, not failed', async () => {
    const store = await loadedStore();
    let endProcess: (reason: string) => void = vi.fn();
    vi.mocked(rebuildCharacterDataset).mockReturnValue(
      new Promise((_resolve, reject) => {
        endProcess = reject;
      })
    );
    vi.mocked(cancelCharacterDatasetRebuild).mockImplementation(async () => {
      endProcess('Rebuild stopped.');
    });

    const done = store.rebuildDataset(REBUILD_REQUEST);
    await flushPromises();
    await store.stopRebuild();
    await expect(done).rejects.toBe('Rebuild stopped.');

    expect(store.rebuildOutcome).toMatchObject({ ok: false, stopped: true });
    expect(store.stopping).toBe(false);
  });

  it('supports redo after undo and clears redo history on new changes', async () => {
    const store = await loadedStore();
    store.setField('hair', ['long_hair']);
    vi.mocked(randomizeCharacterFields).mockResolvedValue({
      hair: ['bob_cut']
    });
    await store.roll(['hair']);

    store.undo();
    expect(store.fields.hair).toEqual(['long_hair']);
    expect(store.canRedo).toBe(true);

    store.redo();
    expect(store.fields.hair).toEqual(['bob_cut']);
    expect(store.canRedo).toBe(false);

    store.undo();
    store.clearField('hair');
    expect(store.fields.hair).toEqual([]);
    expect(store.canRedo).toBe(false);
  });

  it('applies lock presets and reports the active preset', async () => {
    vi.mocked(getCharacterFields).mockResolvedValue([
      field('character', 1),
      field('subject', 2),
      field('hair', 3),
      field('outfit', 2),
      field('pose', 2)
    ]);
    const store = useCharacterHelperStore();
    await store.load();

    expect(store.activeLockPreset).toBe('none');

    store.applyLockPreset('identity');
    expect(store.locks).toEqual(['character', 'subject', 'hair']);
    expect(store.activeLockPreset).toBe('identity');

    store.applyLockPreset('outfit');
    expect(store.locks).toEqual(['character', 'subject', 'hair', 'outfit']);
    expect(store.activeLockPreset).toBe('outfit');

    store.applyLockPreset('all');
    expect(store.activeLockPreset).toBe('all');

    store.toggleLock('pose');
    expect(store.activeLockPreset).toBe('outfit');
  });

  it('locks, clears, and rolls a group while respecting individual locks', async () => {
    const store = await loadedStore();
    store.setField('hair', ['long_hair']);
    store.setField('top', ['hoodie']);

    store.setGroupLock(['hair', 'top'], true);
    expect(store.isLocked('hair')).toBe(true);
    expect(store.isLocked('top')).toBe(true);
    await expect(store.rollGroup(['hair', 'top'])).rejects.toThrow(
      'All fields in this group are locked'
    );

    store.setGroupLock(['top'], false);
    store.clearGroup(['hair', 'top']);
    expect(store.fields.hair).toEqual(['long_hair']);
    expect(store.fields.top).toEqual([]);

    vi.mocked(randomizeCharacterFields).mockResolvedValue({
      top: ['white_shirt']
    });
    await store.rollGroup(['hair', 'top']);
    expect(randomizeCharacterFields).toHaveBeenCalledWith(
      expect.objectContaining({ fields: ['top'] })
    );
    expect(store.fields.top).toEqual(['white_shirt']);
  });

  it('tracks custom dice counts and resets them to defaults', async () => {
    const store = await loadedStore();
    expect(store.hasCustomCounts).toBe(false);

    store.counts.hair = 6;
    expect(store.hasCustomCounts).toBe(true);

    store.resetCounts();
    expect(store.counts.hair).toBe(3);
    expect(store.hasCustomCounts).toBe(false);
  });
});
