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
  extensionBreakdown,
  heatmapWeeks,
  hourlyCounts,
  modelDisplayName,
  modelStorageBreakdown,
  parseDayKey,
  streaks,
  subfolderBreakdown,
  timeOfDayBuckets,
  topModels,
  topPromptTags,
  weekdayCounts
} from '@/utils/generationStats';
import { computed, shallowRef, watch } from 'vue';

export type DailyWindow = 14 | 30 | 90;

export function useGenerationStats() {
  const launcherStore = useLauncherStore();
  const images = shallowRef<OutputImage[]>([]);
  const today = shallowRef(new Date());
  const dailyWindow = shallowRef<DailyWindow>(30);
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
  const dailyWindowSeries = computed(() =>
    dailySeries(dayCounts.value, today.value, dailyWindow.value)
  );
  const hourly = computed(() => hourlyCounts(timestamps.value));
  const weekdays = computed(() => weekdayCounts(timestamps.value));
  const timePeriods = computed(() => timeOfDayBuckets(hourly.value));
  const models = computed(() =>
    topModels(
      images.value.map((image) => image.model),
      6
    )
  );
  const modelStorage = computed(() => modelStorageBreakdown(images.value, 6));
  const subfolders = computed(() => subfolderBreakdown(images.value, 6));
  const formats = computed(() => extensionBreakdown(images.value));
  const promptTags = computed(() =>
    topPromptTags(
      images.value.map((image) => image.prompt),
      12
    )
  );

  const summary = computed(() => {
    const counts = [...dayCounts.value.values()];
    const best = [...dayCounts.value].reduce<[string, number] | null>(
      (top, entry) => (!top || entry[1] > top[1] ? entry : top),
      null
    );
    const last14 = dailySeries(dayCounts.value, today.value, 14);
    const lastWeek = last14.slice(7).reduce((sum, day) => sum + day.count, 0);
    const previousWeek = last14
      .slice(0, 7)
      .reduce((sum, day) => sum + day.count, 0);
    const diskBytes = images.value.reduce(
      (sum, image) => sum + image.fileSize,
      0
    );
    const uniqueModelSet = new Set(
      images.value
        .map((image) => image.model)
        .filter(Boolean)
        .map((model) => modelDisplayName(model))
    );
    const peakHourIndex = hourly.value.reduce(
      (bestHour, count, hour) =>
        count > (hourly.value[bestHour] ?? 0) ? hour : bestHour,
      0
    );
    const peakWeekdayIndex = weekdays.value.reduce(
      (bestDay, count, weekday) =>
        count > (weekdays.value[bestDay] ?? 0) ? weekday : bestDay,
      0
    );
    const total = timestamps.value.length;

    return {
      total,
      today: dayCounts.value.get(dayKey(today.value)) ?? 0,
      lastWeek,
      previousWeek,
      activeDays: counts.length,
      dailyAverage: counts.length > 0 ? Math.round(total / counts.length) : 0,
      bestDay: best ? { date: parseDayKey(best[0]), count: best[1] } : null,
      diskBytes,
      avgFileSize: total > 0 ? Math.round(diskBytes / total) : 0,
      uniqueModels: uniqueModelSet.size,
      peakHour: (hourly.value[peakHourIndex] ?? 0) > 0 ? peakHourIndex : null,
      peakWeekday:
        (weekdays.value[peakWeekdayIndex] ?? 0) > 0 ? peakWeekdayIndex : null,
      ...streaks(dayCounts.value, today.value)
    };
  });

  return {
    isLoading,
    errorMessage,
    load,
    dailyWindow,
    heatmap,
    last30Days,
    dailyWindowSeries,
    hourly,
    weekdays,
    timePeriods,
    models,
    modelStorage,
    subfolders,
    formats,
    promptTags,
    summary
  };
}
