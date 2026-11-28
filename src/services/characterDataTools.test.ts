import { describe, expect, it, vi } from 'vitest';
import {
  autocompleteCharacterTags,
  CHARACTER_DATA_NOTE,
  getCharacterPreset,
  randomizeCharacterFields,
  type CharacterPreset
} from './characterData';
import { characterDataTools } from './characterDataTools';

type ToolExecutor = (input: Record<string, unknown>) => Promise<unknown>;

vi.mock('ai', () => ({ tool: (definition: unknown) => definition }));

vi.mock(import('./characterData'), async (importOriginal) => ({
  ...(await importOriginal()),
  autocompleteCharacterTags: vi.fn(),
  getCharacterPreset: vi.fn(),
  randomizeCharacterFields: vi.fn()
}));

const execute = (name: keyof typeof characterDataTools) =>
  (characterDataTools[name] as unknown as { execute: ToolExecutor }).execute;

const preset = (): CharacterPreset => ({
  character: 'test_girl',
  series: 'test_series',
  count: 1200,
  fields: {
    character: ['test_girl', 'test_series'],
    hair: ['blue_hair'],
    top: ['white_shirt']
  }
});

describe('search_character_data', () => {
  it('returns character matches with the usual look and the reference note', async () => {
    vi.mocked(autocompleteCharacterTags).mockResolvedValue([
      {
        tag: 'test_girl',
        count: 1200,
        kind: 'character',
        series: 'test_series'
      },
      { tag: 'test_series', count: 900, kind: 'series' }
    ]);
    vi.mocked(getCharacterPreset).mockResolvedValue(preset());

    await expect(
      execute('search_character_data')({ query: 'test' })
    ).resolves.toEqual({
      found: true,
      source: 'character_data',
      note: CHARACTER_DATA_NOTE,
      matches: [
        {
          name: 'test_girl',
          series: 'test_series',
          posts: 1200,
          matchedAlias: undefined
        }
      ],
      usualLook: preset()
    });
    expect(getCharacterPreset).toHaveBeenCalledWith('test_girl');
  });

  it('reports no match with the reference note', async () => {
    vi.mocked(autocompleteCharacterTags).mockResolvedValue([]);

    await expect(
      execute('search_character_data')({ query: 'nobody' })
    ).resolves.toMatchObject({
      found: false,
      note: CHARACTER_DATA_NOTE
    });
  });
});

describe('roll_character_look', () => {
  it('rolls every non-character field with the usual look as context', async () => {
    vi.mocked(getCharacterPreset).mockResolvedValue(preset());
    vi.mocked(randomizeCharacterFields).mockResolvedValue({ top: ['hoodie'] });

    const result = await execute('roll_character_look')({
      character: 'test_girl',
      rating: 'general'
    });

    expect(randomizeCharacterFields).toHaveBeenCalledWith({
      fields: ['hair', 'top'],
      context: preset().fields,
      rating: 'general',
      require: undefined
    });
    expect(result).toMatchObject({
      found: true,
      note: CHARACTER_DATA_NOTE,
      fields: { hair: ['blue_hair'], top: ['hoodie'] }
    });
  });

  it('asks for a search when the character is unknown', async () => {
    vi.mocked(getCharacterPreset).mockResolvedValue(null);

    await expect(
      execute('roll_character_look')({ character: 'nobody', rating: 'general' })
    ).resolves.toMatchObject({ found: false, note: CHARACTER_DATA_NOTE });
    expect(randomizeCharacterFields).not.toHaveBeenCalled();
  });
});
