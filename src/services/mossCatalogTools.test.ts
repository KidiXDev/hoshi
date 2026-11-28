import type { MossCatalogEntry } from '@/types/mossCatalog';
import { describe, expect, it, vi } from 'vitest';
import { MOSS_CATALOG_NOTE, searchMossCatalog } from './mossCatalog';
import { mossCatalogTools } from './mossCatalogTools';

type ToolExecutor = (input: Record<string, unknown>) => Promise<unknown>;

vi.mock('ai', () => ({ tool: (definition: unknown) => definition }));

vi.mock(import('./mossCatalog'), async (importOriginal) => ({
  ...(await importOriginal()),
  searchMossCatalog: vi.fn()
}));

const execute = (
  mossCatalogTools.search_moss_catalog as unknown as { execute: ToolExecutor }
).execute;

const entry = (): MossCatalogEntry => ({
  id: '89bd1748a67b5fce996a823d2f784cfb',
  name: 'test girl',
  copyright: 'test series',
  kind: 'style',
  tags: 'test girl, test series, 1girl',
  caption: 'test girl from test series.',
  prompt: 'A single character, test girl.',
  sourceCount: 12,
  gender: ['Female'],
  hairColor: [],
  hairLength: [],
  eyeColor: [],
  outfit: [],
  category: 'anime',
  addedAt: '2026-10-17'
});

describe('search_moss_catalog', () => {
  it('searches styles and returns tags and captions with the reference note', async () => {
    vi.mocked(searchMossCatalog).mockResolvedValue({
      total: 1,
      page: 1,
      pages: 1,
      pageSize: 8,
      results: [entry()]
    });

    const result = await execute({
      query: 'test',
      category: 'styles',
      page: 1
    });

    expect(searchMossCatalog).toHaveBeenCalledWith({
      query: 'test',
      kind: 'style',
      page: 1,
      pageSize: 8
    });
    expect(result).toEqual({
      source: 'moss_catalog',
      note: MOSS_CATALOG_NOTE,
      total: 1,
      page: 1,
      pages: 1,
      results: [
        {
          id: entry().id,
          name: 'test girl',
          copyright: 'test series',
          tags: 'test girl, test series, 1girl',
          caption: 'test girl from test series.'
        }
      ]
    });
  });
});
