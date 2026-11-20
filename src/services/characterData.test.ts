import { invoke } from '@tauri-apps/api/core';
import { describe, expect, it, vi } from 'vitest';
import {
  formatCharacterTag,
  formatCharacterTags,
  randomizeCharacterFields
} from './characterData';

vi.mock(import('@tauri-apps/api/core'), async (importOriginal) => ({
  ...(await importOriginal()),
  invoke: vi.fn()
}));

const PLAIN = { spaces: false, escape: false };
const PROMPT = { spaces: true, escape: true };

describe('formatCharacterTag', () => {
  it('turns underscores into spaces and escapes brackets', () => {
    expect(formatCharacterTag('ganyu_(genshin_impact)', PROMPT)).toBe(
      'ganyu \\(genshin impact\\)'
    );
  });

  it('keeps emoticon underscores', () => {
    expect(formatCharacterTag('^_^', PROMPT)).toBe('^_^');
    expect(formatCharacterTag('>_<', PROMPT)).toBe('>_<');
  });

  it('formats the tag inside a weight and keeps the weight', () => {
    expect(formatCharacterTag('(blue_hair:1.2)', PROMPT)).toBe(
      '(blue hair:1.2)'
    );
  });

  it('does not escape brackets twice', () => {
    expect(formatCharacterTag('a_\\(b\\)', PROMPT)).toBe('a \\(b\\)');
  });

  it('leaves the tag alone when formatting is off', () => {
    expect(formatCharacterTag('long_hair', PLAIN)).toBe('long_hair');
  });
});

describe('formatCharacterTags', () => {
  it('puts the subject first and drops duplicates', () => {
    expect(
      formatCharacterTags(
        {
          character: ['hatsune_miku'],
          subject: ['1girl', 'solo'],
          hair: ['long_hair', 'long hair']
        },
        PROMPT
      )
    ).toEqual(['1girl', 'solo', 'hatsune miku', 'long hair']);
  });
});

describe('randomizeCharacterFields', () => {
  it('sends defaults for counts and required tags', async () => {
    vi.mocked(invoke).mockResolvedValue({ hair: ['short_hair'] });

    await randomizeCharacterFields({
      fields: ['hair'],
      context: {},
      rating: 'general'
    });

    expect(invoke).toHaveBeenCalledWith('character_data_randomize', {
      fields: ['hair'],
      counts: {},
      context: {},
      rating: 'general',
      seed: undefined,
      require: []
    });
  });
});
