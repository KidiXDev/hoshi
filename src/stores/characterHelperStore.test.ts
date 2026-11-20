import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCharacterFields,
  getCharacterPreset,
  randomizeCharacterFields,
  type CharacterField
} from '../services/characterData';
import { useCharacterHelperStore } from './characterHelperStore';
import { useWorkflowStore } from './workflowStore';

vi.mock(import('../services/characterData'), async (importOriginal) => ({
  ...(await importOriginal()),
  getCharacterFields: vi.fn(),
  getCharacterPreset: vi.fn(),
  randomizeCharacterFields: vi.fn()
}));

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
});
