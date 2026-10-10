import { describe, expect, it } from 'vitest';
import type { CharacterLibraryItem, LibraryItem } from '../types/library';
import { matchesQuery, searchCharacterEntries } from './librarySearch';

const base = { category: 'characters', createdAt: 0, updatedAt: 0 } as const;

const miku: CharacterLibraryItem = {
  ...base,
  id: 'a',
  name: 'Hatsune Miku',
  data: {
    trigger: 'hatsune_miku',
    series: 'Vocaloid',
    tags: ['aqua hair', 'twintails'],
    notes: 'Always cheerful; avoid dark themes.'
  }
};

const rin: CharacterLibraryItem = {
  ...base,
  id: 'b',
  name: 'Kagamine Rin',
  data: {
    trigger: 'kagamine_rin',
    series: 'Vocaloid',
    tags: ['blonde hair', 'hair bow', 'cheerful']
  }
};

const sunset: LibraryItem = {
  ...base,
  id: 'c',
  category: 'prompts',
  name: 'Sunset',
  data: { type: 'both', positive: 'golden hour, beach', negative: 'lowres' }
};

describe('matchesQuery', () => {
  it('searches character notes and tags', () => {
    expect(matchesQuery(miku, 'dark themes')).toBe(true);
    expect(matchesQuery(rin, 'hair bow')).toBe(true);
    expect(matchesQuery(rin, 'dark')).toBe(false);
  });

  it('requires every term to match', () => {
    expect(matchesQuery(miku, 'vocaloid twintails')).toBe(true);
    expect(matchesQuery(miku, 'vocaloid blonde')).toBe(false);
  });

  it('searches non-character payloads and tolerates missing data', () => {
    expect(matchesQuery(sunset, 'beach')).toBe(true);
    expect(matchesQuery(sunset, 'lowres')).toBe(true);
    expect(matchesQuery({ ...sunset, data: null }, 'sunset')).toBe(true);
  });
});

describe('searchCharacterEntries', () => {
  it('ranks name and trigger matches above tag and notes matches', () => {
    expect(
      searchCharacterEntries([miku, rin], 'cheerful').map((entry) => entry.id)
    ).toEqual(['a', 'b']);
    expect(
      searchCharacterEntries([miku, rin], 'kagamine').map((entry) => entry.id)
    ).toEqual(['b']);
  });
});
