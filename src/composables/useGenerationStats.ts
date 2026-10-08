import {
  listOutputImages,
  refreshOutputImages,
  type OutputImage
} from '@/services/imageGallery';
import { useLauncherStore } from '@/stores/launcherStore';
import {
  countByDay,
  dailySeries,
  dayKey,
  heatmapWeeks,
  hourlyCounts,
  parseDayKey,
  streaks,
  topModels
} from '@/utils/generationStats';
import { computed, shallowRef, watch } from 'vue';

export function useGenerationStats() {
  const launcherStore = useLauncherStore();
  const images = shallowRef<OutputImage[]>([]);
  const today = shallowRef(new Date());
  const isLoading = shallowRef(false);
  const errorMessage = shallowRef('');

  async function load(rescan = false) {
    const workingDir = launcherStore.config.workingDir;
    if (!launcherStore.hasComfyDirectory) {
      images.value = [];
      return;
    }
    isLoading.value = true;
    errorMessage.value = '';
    try {
      const result = await (rescan ? refreshOutputImages : listOutputImages)(
        workingDir,
        launcherStore.launchArgs
      );
      if (workingDir !== launcherStore.config.workingDir) return;
      images.value = result;
      today.value = new Date();
    } catch (error) {
      errorMessage.value =
        error instanceof Error ? error.message : String(error);
    } finally {
      isLoading.value = false;
    }
  }

  watch(
    () => [launcherStore.config.workingDir, launcherStore.config.args],
    async () => {
      await load();
      void load(true);
    },
    { immediate: true }
  );

  const timestamps = computed(() =>
    images.value.map((image) => image.modifiedMs).filter((ms) => ms > 0)
  );
  const dayCounts = computed(() => countByDay(timestamps.value));
  const heatmap = computed(() => heatmapWeeks(dayCounts.value, today.value));
  const last30Days = computed(() =>
    dailySeries(dayCounts.value, today.value, 30)
  );
  const hourly = computed(() => hourlyCounts(timestamps.value));
  const models = computed(() =>
    topModels(
      images.value.map((image) => image.model),
      7
    )
  );

  const summary = computed(() => {
    const counts = [...dayCounts.value.values()];
    const best = [...dayCounts.value].reduce<[string, number] | null>(
      (top, entry) => (!top || entry[1] > top[1] ? entry : top),
      null
    );
    const lastWeek = dailySeries(dayCounts.value, today.value, 7).reduce(
      (sum, day) => sum + day.count,
      0
    );
    return {
      total: timestamps.value.length,
      today: dayCounts.value.get(dayKey(today.value)) ?? 0,
      lastWeek,
      activeDays: counts.length,
      dailyAverage:
        counts.length > 0
          ? Math.round(timestamps.value.length / counts.length)
          : 0,
      bestDay: best ? { date: parseDayKey(best[0]), count: best[1] } : null,
      diskBytes: images.value.reduce((sum, image) => sum + image.fileSize, 0),
      ...streaks(dayCounts.value, today.value)
    };
  });

  return {
    isLoading,
    errorMessage,
    load,
    heatmap,
    last30Days,
    hourly,
    models,
    summary
  };
}
