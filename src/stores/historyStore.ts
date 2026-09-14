import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import {
  deleteAppData,
  loadAppData,
  saveAppData
} from '../services/appStorage';
import { localImageUrl, resolveHistoryImages } from '../services/imageGallery';
import type { HistoryItem, WorkflowState } from '../types/workflow';
import { parseLauncherArgs, useLauncherStore } from './launcherStore';

const STORAGE_KEY = 'session_history';
const PANEL_OPEN_STORAGE_KEY = 'workflow_history_panel_open';

function getInitialPanelOpen(): boolean {
  try {
    const saved = localStorage.getItem(PANEL_OPEN_STORAGE_KEY);
    if (saved !== null) {
      return saved === 'true';
    }
  } catch {}
  return true;
}

export const useHistoryStore = defineStore('history', () => {
  const launcherStore = useLauncherStore();
  const items = ref<HistoryItem[]>([]);
  const isPanelOpen = ref(getInitialPanelOpen());
  const isDrawerOpen = ref(false);
  const imageSession = Date.now();

  async function resolveLocalImages(historyItems = items.value) {
    const { workingDir, args } = launcherStore.config;
    if (!workingDir || historyItems.length === 0) return;
    try {
      const resolved = await resolveHistoryImages(
        workingDir,
        parseLauncherArgs(args),
        historyItems
      );
      if (
        workingDir !== launcherStore.config.workingDir ||
        args !== launcherStore.config.args
      )
        return;
      for (const item of historyItems) {
        if (resolved[item.id])
          item.imageUrl = `${localImageUrl(resolved[item.id])}?session=${imageSession}`;
      }
    } catch (error) {
      console.warn('Could not resolve local history images', error);
    }
  }

  watch(
    () => [launcherStore.config.workingDir, launcherStore.config.args],
    () => {
      void resolveLocalImages();
    }
  );

  watch(isPanelOpen, (val) => {
    try {
      localStorage.setItem(PANEL_OPEN_STORAGE_KEY, String(val));
    } catch {}
  });

  async function loadHistory() {
    try {
      const saved = await loadAppData<HistoryItem[]>(STORAGE_KEY);
      if (saved) {
        // Local URLs must be registered again before this process can serve them.
        for (const item of saved) {
          if (item.imageUrl.includes('koharu-image')) item.imageUrl = '';
        }
        items.value = saved;
        await resolveLocalImages();
      }
    } catch {}
  }

  async function saveHistory() {
    await saveAppData(STORAGE_KEY, items.value.slice(0, 50));
  }

  function addHistory(
    imageUrl: string,
    filename: string,
    subfolder: string,
    type: string,
    promptId: string,
    workflowState: WorkflowState,
    durationMs?: number
  ) {
    const newItem: HistoryItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      imageUrl,
      filename,
      subfolder,
      type,
      promptId,
      workflowState: JSON.parse(JSON.stringify(workflowState)),
      durationMs
    };

    items.value.unshift(newItem);
    if (items.value.length > 50) {
      items.value.pop();
    }
    void saveHistory();
    void resolveLocalImages([items.value[0]]);
  }

  function removeHistory(id: string) {
    items.value = items.value.filter((i) => i.id !== id);
    void saveHistory();
  }

  function clearHistory() {
    items.value = [];
    void deleteAppData(STORAGE_KEY);
  }

  void loadHistory();

  return {
    items,
    isPanelOpen,
    isDrawerOpen,
    loadHistory,
    addHistory,
    removeHistory,
    clearHistory
  };
});
