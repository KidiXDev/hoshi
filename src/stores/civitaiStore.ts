import { useDebounceFn } from '@vueuse/core';
import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { loadAppData, saveAppData } from '../services/appStorage';
import {
  discoverLocalModels,
  fetchCivitaiBaseModels,
  type CivitaiModel
} from '../services/civitai';
import type { BridgeModelsResponse } from '../types/comfy';
import { parseLauncherArgs, useLauncherStore } from './launcherStore';

export interface CivitaiBrowserFilterState {
  modelType?: string;
  baseModel?: string;
  sort?: string;
  period?: string;
}

export const useCivitaiStore = defineStore('civitai', () => {
  const launcherStore = useLauncherStore();
  const localModels = ref<Partial<BridgeModelsResponse> | null>(null);
  const discoveryError = ref('');
  let discoveryRequest = 0;
  let discoveryStarted = false;

  async function refreshLocalModels() {
    discoveryStarted = true;
    const request = ++discoveryRequest;
    discoveryError.value = '';
    if (launcherStore.localSetupMessage) {
      localModels.value = null;
      return;
    }
    const { workingDir, pythonPath, args } = launcherStore.config;
    try {
      const models = await discoverLocalModels(
        workingDir,
        pythonPath,
        parseLauncherArgs(args)
      );
      if (request === discoveryRequest) localModels.value = models;
    } catch (error) {
      if (request === discoveryRequest) {
        localModels.value = null;
        discoveryError.value = `Local model discovery failed: ${String(error)}`;
      }
    }
  }

  watch(
    () => [
      launcherStore.config.workingDir,
      launcherStore.config.pythonPath,
      launcherStore.config.args
    ],
    () => {
      ++discoveryRequest;
      localModels.value = null;
      discoveryError.value = '';
      if (discoveryStarted) void refreshLocalModels();
    }
  );
  const isLoaded = ref(false);
  const query = ref('');
  const modelType = ref('all');
  const baseModel = ref('all');
  const sort = ref('Most Downloaded');
  const period = ref('AllTime');
  const baseModels = ref<string[]>([]);

  const persistState = useDebounceFn(async () => {
    if (!isLoaded.value) return;
    try {
      await saveAppData('civitai_browser_state', {
        modelType: modelType.value,
        baseModel: baseModel.value,
        sort: sort.value,
        period: period.value
      });
    } catch (err) {
      console.error('Failed to save civitai browser state:', err);
    }
  }, 400);

  watch([modelType, baseModel, sort, period], () => {
    void persistState();
  });

  async function loadState() {
    try {
      const saved = await loadAppData<CivitaiBrowserFilterState>(
        'civitai_browser_state'
      );
      if (saved) {
        if (typeof saved.modelType === 'string')
          modelType.value = saved.modelType;
        if (typeof saved.baseModel === 'string')
          baseModel.value = saved.baseModel;
        if (typeof saved.sort === 'string') sort.value = saved.sort;
        if (typeof saved.period === 'string') period.value = saved.period;
      }
    } catch (err) {
      console.error('Failed to load civitai browser state:', err);
    } finally {
      isLoaded.value = true;
    }
  }

  async function loadBaseModels() {
    try {
      const list = await fetchCivitaiBaseModels();
      baseModels.value = list;
    } catch (err) {
      console.error('Failed to load civitai base models:', err);
    }
  }

  function resetFilters() {
    query.value = '';
    modelType.value = 'all';
    baseModel.value = 'all';
    sort.value = 'Most Downloaded';
    period.value = 'AllTime';
  }

  // Bookmarks
  const bookmarks = ref<CivitaiModel[]>([]);
  const bookmarkIds = computed(
    () => new Set(bookmarks.value.map((model) => model.id))
  );

  async function loadBookmarks() {
    try {
      const saved = await loadAppData<CivitaiModel[]>('civitai_bookmarks');
      if (Array.isArray(saved)) bookmarks.value = saved;
    } catch (err) {
      console.error('Failed to load civitai bookmarks:', err);
    }
  }

  function isBookmarked(modelId: number) {
    return bookmarkIds.value.has(modelId);
  }

  async function toggleBookmark(model: CivitaiModel) {
    const bookmarked = !isBookmarked(model.id);
    bookmarks.value = bookmarked
      ? [model, ...bookmarks.value]
      : bookmarks.value.filter((item) => item.id !== model.id);
    await saveAppData('civitai_bookmarks', bookmarks.value);
    return bookmarked;
  }

  async function init() {
    await Promise.all([loadState(), loadBaseModels(), loadBookmarks()]);
  }

  return {
    isLoaded,
    localModels,
    discoveryError,
    refreshLocalModels,
    query,
    modelType,
    baseModel,
    sort,
    period,
    baseModels,
    bookmarks,
    isBookmarked,
    toggleBookmark,
    init,
    loadState,
    loadBaseModels,
    resetFilters
  };
});
