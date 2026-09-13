import { isVerified, type LocalModel } from '../services/modelManager';

export type ModelSyncFilter = 'all' | 'synced' | 'unsynced' | 'update';
export type ModelPreviewFilter = 'all' | 'with' | 'without';
export type ModelSortKey = 'name' | 'size' | 'date';

export interface ModelFilters {
  category: string;
  search: string;
  baseModel: string;
  sync: ModelSyncFilter;
  preview: ModelPreviewFilter;
  sort: ModelSortKey;
  sortDir: 'asc' | 'desc';
}

export const DEFAULT_MODEL_FILTERS: ModelFilters = {
  category: 'all',
  search: '',
  baseModel: 'all',
  sync: 'all',
  preview: 'all',
  sort: 'name',
  sortDir: 'asc'
};

export function hasModelUpdate(model: LocalModel): boolean {
  const summary = model.civitai;
  return Boolean(
    summary?.latestVersionId &&
    summary.versionId &&
    summary.latestVersionId !== summary.versionId
  );
}

function searchHaystack(model: LocalModel): string {
  const summary = model.civitai;
  return [
    model.relativeName,
    model.filename,
    summary?.modelName ?? '',
    summary?.versionName ?? '',
    summary?.baseModel ?? '',
    ...(summary?.trainedWords ?? [])
  ]
    .join('\n')
    .toLowerCase();
}

const nameCollator = new Intl.Collator(undefined, {
  sensitivity: 'base',
  numeric: true
});

/** Stable sort by the chosen key; returns a new array. */
export function sortModels(
  models: LocalModel[],
  sort: ModelSortKey,
  sortDir: 'asc' | 'desc'
): LocalModel[] {
  const direction = sortDir === 'desc' ? -1 : 1;
  const compare = (a: LocalModel, b: LocalModel): number => {
    switch (sort) {
      case 'size':
        return a.fileSize - b.fileSize;
      case 'date':
        return a.modifiedMs - b.modifiedMs;
      default:
        return nameCollator.compare(a.relativeName, b.relativeName);
    }
  };
  return [...models].sort((a, b) => direction * compare(a, b));
}

/** Applies category/base-model/sync/preview/search filters, preserving order. */
export function filterModels(
  models: LocalModel[],
  filters: Omit<ModelFilters, 'sort' | 'sortDir'>
): LocalModel[] {
  const terms = filters.search.toLowerCase().split(/\s+/u).filter(Boolean);
  return models.filter((model) => {
    if (filters.category !== 'all' && model.category !== filters.category)
      return false;
    if (
      filters.baseModel !== 'all' &&
      (model.civitai?.baseModel ?? '') !== filters.baseModel
    )
      return false;
    switch (filters.sync) {
      case 'synced':
        if (!isVerified(model)) return false;
        break;
      case 'unsynced':
        if (isVerified(model)) return false;
        break;
      case 'update':
        if (!hasModelUpdate(model)) return false;
        break;
      default:
        break;
    }
    if (filters.preview === 'with' && !model.previewPath) return false;
    if (filters.preview === 'without' && model.previewPath) return false;
    if (terms.length > 0) {
      const haystack = searchHaystack(model);
      if (!terms.every((term) => haystack.includes(term))) return false;
    }
    return true;
  });
}

export function filterAndSortModels(
  models: LocalModel[],
  filters: ModelFilters
): LocalModel[] {
  return filterModels(
    sortModels(models, filters.sort, filters.sortDir),
    filters
  );
}

/** Distinct Civitai base models present in the index, sorted for a Select. */
export function collectBaseModels(models: LocalModel[]): string[] {
  const set = new Set<string>();
  for (const model of models) {
    const base = model.civitai?.baseModel?.trim();
    if (base) set.add(base);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/** Category → count map (unfiltered except by search/base model/sync/preview). */
export function countByCategory(models: LocalModel[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const model of models) {
    counts[model.category] = (counts[model.category] ?? 0) + 1;
  }
  return counts;
}
