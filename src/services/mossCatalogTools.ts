import { tool } from 'ai';
import { z } from 'zod';
import { MOSS_CATALOG_NOTE, searchMossCatalog } from './mossCatalog';

export const mossCatalogTools = {
  search_moss_catalog: tool({
    description: `Search the MOSS Image Character Catalog (34k characters and 314 art styles) by name, series, or tag. Each result has comma tags and a natural-language caption written for MOSS Image. Use styles to find a reusable art style description. ${MOSS_CATALOG_NOTE}`,
    inputSchema: z.object({
      query: z
        .string()
        .min(1)
        .describe('Character name, series, style name, or tag keywords'),
      category: z.enum(['characters', 'styles']).default('characters'),
      page: z.number().int().positive().default(1)
    }),
    execute: async ({ query, category, page }) => {
      const response = await searchMossCatalog({
        query,
        kind: category === 'styles' ? 'style' : 'character',
        page,
        pageSize: 8
      });
      return {
        source: 'moss_catalog',
        note: MOSS_CATALOG_NOTE,
        total: response.total,
        page: response.page,
        pages: response.pages,
        results: response.results.map((entry) => ({
          id: entry.id,
          name: entry.name,
          copyright: entry.copyright,
          tags: entry.tags,
          caption: entry.caption
        }))
      };
    }
  })
};
