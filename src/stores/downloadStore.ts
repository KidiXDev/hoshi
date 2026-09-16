import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { rescanLocalModelIndex } from '../composables/useModelManagerQueries';
import { loadAppData } from '../services/appStorage';
import {
  cancelDownload,
  clearDownloadHistory,
  listDownloads,
  pauseDownload,
  queueCivitaiDownload,
  resumeDownload,
  type DownloadRecord
} from '../services/downloadManager';
import { useCivitaiStore } from './civitaiStore';
import {
  cleanPath,
  parseLauncherArgs,
  useLauncherStore
} from './launcherStore';

export function shouldPollDownloads(records: Pick<DownloadRecord, 'status'>[]) {
  return records.some((record) =>
    ['active', 'waiting'].includes(record.status)
  );
}

export const useDownloadStore = defineStore('downloads', () => {
  const launcherStore = useLauncherStore();
  const civitaiStore = useCivitaiStore();
  const items = ref<DownloadRecord[]>([]);
  const errorMessage = ref('');
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;

  const activeCount = computed(
    () =>
      items.value.filter((item) =>
        ['active', 'waiting', 'paused'].includes(item.status)
      ).length
  );

  async function indexFinishedDownloads() {
    const { workingDir, args } = launcherStore.config;
    if (!cleanPath(workingDir)) return;
    void civitaiStore.refreshLocalModels();
    await rescanLocalModelIndex(cleanPath(workingDir), parseLauncherArgs(args));
  }

  async function refresh() {
    try {
      const unfinished = new Set(
        items.value
          .filter((item) => item.status !== 'complete')
          .map((item) => item.gid)
      );
      items.value = await listDownloads();
      errorMessage.value = '';
      if (
        items.value.some(
          (item) => item.status === 'complete' && unfinished.has(item.gid)
        )
      )
        await indexFinishedDownloads();
    } catch (error) {
      errorMessage.value =
        error instanceof Error ? error.message : String(error);
    }
  }

  function scheduleRefresh() {
    if (refreshTimer || !shouldPollDownloads(items.value)) return;
    refreshTimer = setTimeout(async () => {
      refreshTimer = null;
      await refresh();
      scheduleRefresh();
    }, 1000);
  }

  async function init() {
    if (refreshTimer) return;
    await refresh();
    scheduleRefresh();
  }

  async function enqueueCivitai(options: {
    versionId: number;
    workingDir: string;
    apiKey: string;
  }) {
    if (!cleanPath(options.workingDir))
      throw new Error(
        'Choose your ComfyUI folder in Settings before downloading models.'
      );
    if (!Number.isSafeInteger(options.versionId) || options.versionId <= 0)
      throw new Error('Select a valid model version before downloading.');
    const settings = await loadAppData<{ apiKey?: string }>('civitai_settings');
    const record = await queueCivitaiDownload({
      ...options,
      apiKey: (settings?.apiKey ?? options.apiKey).trim()
    });
    const index = items.value.findIndex((item) => item.gid === record.gid);
    if (index === -1) items.value.unshift(record);
    else items.value[index] = record;
    scheduleRefresh();
    return record;
  }

  async function pause(gid: string) {
    await pauseDownload(gid);
    await refresh();
  }

  async function resume(gid: string) {
    await resumeDownload(gid);
    await refresh();
    scheduleRefresh();
  }

  async function cancel(gid: string) {
    await cancelDownload(gid);
    items.value = items.value.filter((item) => item.gid !== gid);
  }

  async function clearHistory(gid?: string) {
    try {
      await clearDownloadHistory(gid);
      items.value = items.value.filter(
        (item) =>
          (gid !== undefined && item.gid !== gid) ||
          ['active', 'waiting', 'paused'].includes(item.status)
      );
    } catch (error) {
      errorMessage.value =
        error instanceof Error ? error.message : String(error);
    }
  }

  function byVersion(versionId: number) {
    return items.value.find((item) => item.versionId === versionId);
  }

  function stop() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = null;
  }

  return {
    items,
    errorMessage,
    activeCount,
    init,
    stop,
    refresh,
    enqueueCivitai,
    pause,
    resume,
    cancel,
    clearHistory,
    byVersion
  };
});
