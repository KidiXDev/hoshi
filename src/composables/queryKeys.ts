export const queryKeys = {
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
  }
};
