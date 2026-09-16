export const queryKeys = {
  comfy: {
    all: ['comfy'] as const,
    health: (url: string) => ['comfy', 'health', url] as const,
    models: (url?: string) => ['comfy', 'models', url ?? ''] as const,
    system: (url?: string) => ['comfy', 'system', url ?? ''] as const,
    nodeInfo: (url: string, classType: string) =>
      ['comfy', 'nodeInfo', url, classType] as const,
    tagAutocompleteSettings: (url: string) =>
      ['comfy', 'tagAutocompleteSettings', url] as const,
    tagAutocompleteSearch: (url: string, query: string, mode: string) =>
      ['comfy', 'tagAutocompleteSearch', url, query, mode] as const,
    history: (url: string, promptId: string) =>
      ['comfy', 'history', url, promptId] as const,
    modelMetadata: (url: string, folderType: string) =>
      ['comfy', 'modelMetadata', url, folderType] as const
  },
  animadex: {
    all: ['animadex'] as const,
    characters: (params: Record<string, unknown>) =>
      ['animadex', 'characters', params] as const,
    artists: (params: Record<string, unknown>) =>
      ['animadex', 'artists', params] as const,
    copyrights: (params: Record<string, unknown>) =>
      ['animadex', 'copyrights', params] as const,
    characterFacets: () => ['animadex', 'facets', 'characters'] as const,
    artistFacets: () => ['animadex', 'facets', 'artists'] as const,
    copyrightFacets: () => ['animadex', 'facets', 'copyrights'] as const,
    facetSearch: (mode: string, facet: string, query: string) =>
      ['animadex', 'facetSearch', mode, facet, query] as const
  },
  booru: {
    all: ['booru'] as const,
    sources: () => ['booru', 'sources'] as const,
    search: (options: Record<string, unknown>) =>
      ['booru', 'search', options] as const,
    detail: (source: string, postId: string) =>
      ['booru', 'detail', source, postId] as const,
    settings: () => ['booru', 'settings'] as const
  },
  civitai: {
    all: ['civitai'] as const,
    models: (options: Record<string, unknown>) =>
      ['civitai', 'models', options] as const,
    modelDetail: (id: number | string) =>
      ['civitai', 'model', Number(id)] as const,
    imageMeta: (id: number) => ['civitai', 'imageMeta', id] as const,
    baseModels: () => ['civitai', 'baseModels'] as const
  },
  models: {
    all: ['models'] as const,
    index: (comfyRoot: string) => ['models', 'index', comfyRoot] as const,
    byName: (comfyRoot: string, category: string, name: string) =>
      ['models', 'byName', comfyRoot, category, name] as const,
    metadata: (id: string) => ['models', 'metadata', id] as const
  },
  danbooru: {
    all: ['danbooru'] as const,
    wiki: (title: string) => ['danbooru', 'wiki', title] as const,
    posts: (ids: number[]) =>
      [
        'danbooru',
        'posts',
        [...ids].sort((a: number, b: number) => a - b).join(',')
      ] as const
  }
};
