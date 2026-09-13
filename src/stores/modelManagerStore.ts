import { useDebounceFn } from '@vueuse/core';
import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { loadAppData, saveAppData } from '../services/appStorage';
import {
  DEFAULT_MODEL_FILTERS,
  type ModelFilters,
  type ModelPreviewFilter,
  type ModelSortKey,
  type ModelSyncFilter
} from '../utils/modelFilters';

type PersistedState = Partial<Omit<ModelFilters, 'search'>>;

const SYNC_VALUES: ModelSyncFilter[] = ['all', 'synced', 'unsynced', 'update'];
const PREVIEW_VALUES: ModelPreviewFilter[] = ['all', 'with', 'without'];
const SORT_VALUES: ModelSortKey[] = ['name', 'size', 'date'];

/** Filter/sort state for the Model Manager page (persisted, except search). */
export const useModelManagerStore = defineStore('modelManager', () => {
  const isLoaded = ref(false);
  const category = ref(DEFAULT_MODEL_FILTERS.category);
  const search = ref('');
  const baseModel = ref(DEFAULT_MODEL_FILTERS.baseModel);
  const sync = ref<ModelSyncFilter>(DEFAULT_MODEL_FILTERS.sync);
  const preview = ref<ModelPreviewFilter>(DEFAULT_MODEL_FILTERS.preview);
  const sort = ref<ModelSortKey>(DEFAULT_MODEL_FILTERS.sort);
  const sortDir = ref<'asc' | 'desc'>(DEFAULT_MODEL_FILTERS.sortDir);

  const filters = computed<ModelFilters>(() => ({
    category: category.value,
    search: search.value,
    baseModel: baseModel.value,
    sync: sync.value,
    preview: preview.value,
    sort: sort.value,
    sortDir: sortDir.value
  }));

  const hasActiveFilters = computed(
    () =>
      search.value.trim() !== '' ||
      category.value !== 'all' ||
      baseModel.value !== 'all' ||
      sync.value !== 'all' ||
      preview.value !== 'all'
  );

  const persistState = useDebounceFn(async () => {
    if (!isLoaded.value) return;
    try {
      await saveAppData('model_manager_state', {
        category: category.value,
        baseModel: baseModel.value,
        sync: sync.value,
        preview: preview.value,
        sort: sort.value,
        sortDir: sortDir.value
      } satisfies PersistedState);
    } catch (error) {
      console.error('Failed to save model manager state:', error);
    }
  }, 400);

  watch([category, baseModel, sync, preview, sort, sortDir], () => {
    void persistState();
  });

  async function loadState() {
    if (isLoaded.value) return;
    try {
      const saved = await loadAppData<PersistedState>('model_manager_state');
      if (saved) {
        if (typeof saved.category === 'string') category.value = saved.category;
        if (typeof saved.baseModel === 'string')
          baseModel.value = saved.baseModel;
        if (saved.sync && SYNC_VALUES.includes(saved.sync))
          sync.value = saved.sync;
        if (saved.preview && PREVIEW_VALUES.includes(saved.preview))
          preview.value = saved.preview;
        if (saved.sort && SORT_VALUES.includes(saved.sort))
          sort.value = saved.sort;
        if (saved.sortDir === 'asc' || saved.sortDir === 'desc')
          sortDir.value = saved.sortDir;
      }
    } catch (error) {
      console.error('Failed to load model manager state:', error);
    } finally {
      isLoaded.value = true;
    }
  }

  function resetFilters() {
    category.value = DEFAULT_MODEL_FILTERS.category;
    search.value = '';
    baseModel.value = DEFAULT_MODEL_FILTERS.baseModel;
    sync.value = DEFAULT_MODEL_FILTERS.sync;
    preview.value = DEFAULT_MODEL_FILTERS.preview;
  }

  return {
    isLoaded,
    category,
    search,
    baseModel,
    sync,
    preview,
    sort,
    sortDir,
    filters,
    hasActiveFilters,
    loadState,
    resetFilters
  };
});
