import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseTagCsv,
  searchTagEntries,
  searchTags,
  TagAutocomplete
} from './tagAutocomplete';
import { searchWildcards, Wildcards } from './wildcards';

vi.mock(import('@tauri-apps/api/core'), async (importOriginal) => ({
  ...(await importOriginal()),
  invoke: vi.fn()
}));

const CSV = [
  'long_hair,0,900,"longhair,very_long"',
  'hair_ornament,0,500,null',
  'hatsune_miku,4,800,miku',
  'pekeko_(pepekekeko),1,913,pepekekeko',
  'long_hair,0,1,',
  ''
].join('\r\n');

describe('parseTagCsv', () => {
  it('parses quoted aliases, null aliases and keeps the first duplicate', () => {
    expect(parseTagCsv(CSV)).toEqual([
      {
        tag: 'long_hair',
        category: 0,
        totalPost: 900,
        terms: ['long_hair', 'longhair', 'very_long']
      },
      {
        tag: 'hair_ornament',
        category: 0,
        totalPost: 500,
        terms: ['hair_ornament']
      },
      {
        tag: 'hatsune_miku',
        category: 4,
        totalPost: 800,
        terms: ['hatsune_miku', 'miku']
      },
      {
        tag: 'pekeko_(pepekekeko)',
        category: 1,
        totalPost: 913,
        terms: ['pekeko_(pepekekeko)', 'pepekekeko']
      }
    ]);
  });
});

const labels = (...args: Parameters<typeof searchTagEntries>) =>
  searchTagEntries(...args).map((item) => item.label);

describe('searchTagEntries', () => {
  const entries = parseTagCsv(CSV);

  it('ranks prefix matches above substring matches', () => {
    expect(labels(entries, 'hair', 10, 'contains')).toEqual([
      'hair_ornament',
      'long_hair'
    ]);
  });

  it('matches aliases', () => {
    expect(labels(entries, 'miku', 10, 'prefix')).toEqual(['hatsune_miku']);
  });

  it('only matches prefixes in prefix mode', () => {
    expect(labels(entries, 'hair', 10, 'prefix')).toEqual(['hair_ornament']);
  });

  it('adds subsequence matches in fuzzy mode', () => {
    expect(labels(entries, 'hsmk', 10, 'contains')).toEqual([]);
    expect(labels(entries, 'hsmk', 10, 'fuzzy')).toEqual(['hatsune_miku']);
  });

  it('filters by category and sorts an empty query by post count', () => {
    expect(labels(entries, '', 10, 'fuzzy')).toEqual([
      'pekeko_(pepekekeko)',
      'long_hair',
      'hatsune_miku',
      'hair_ornament'
    ]);
    expect(labels(entries, '', 10, 'fuzzy', 1)).toEqual([
      'pekeko_(pepekekeko)'
    ]);
  });

  it('returns autocomplete items', () => {
    expect(searchTagEntries(entries, 'long hair', 1, 'fuzzy')).toEqual([
      {
        label: 'long_hair',
        insert_text: 'long_hair',
        category: 0,
        total_post: 900
      }
    ]);
  });
});

describe('searchWildcards', () => {
  it('matches names and inserts the wildcard token', () => {
    expect(
      searchWildcards(
        { 'pose/sitting': ['a', 'b'], pose: ['c'], color: ['d'] },
        'POSE',
        5
      )
    ).toEqual([
      {
        label: 'pose',
        insert_text: '__pose__',
        category: 'Wildcard',
        total_post: 1,
        kind: 'wildcard'
      },
      {
        label: 'pose/sitting',
        insert_text: '__pose/sitting__',
        category: 'Wildcard',
        total_post: 2,
        kind: 'wildcard'
      }
    ]);
  });
});

describe('searchTags', () => {
  beforeEach(async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(new TextEncoder().encode(CSV).buffer)
      .mockResolvedValueOnce({ pose: ['standing'] });
    await TagAutocomplete.reload();
    await Wildcards.reload();
  });

  it('searches artists only in artist mode', async () => {
    const items = await searchTags('pe', 10, 'artist', 'fuzzy');

    expect(items.map((item) => item.label)).toEqual(['pekeko_(pepekekeko)']);
  });

  it('searches wildcard names in wildcard mode', async () => {
    const items = await searchTags('po', 10, 'wildcard', 'fuzzy');

    expect(items.map((item) => item.insert_text)).toEqual(['__pose__']);
  });

  it('returns nothing when the tag data cannot be loaded', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('no data'));
    await expect(TagAutocomplete.reload()).rejects.toThrow('no data');

    expect(await searchTags('hair', 10, 'tag', 'fuzzy')).toEqual([]);
  });
});
