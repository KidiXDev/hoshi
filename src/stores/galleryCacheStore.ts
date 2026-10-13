import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import {
  clearGalleryCache,
  onGalleryIndexProgress,
  prepareOutputGallery,
  type GalleryIndexProgress
} from '../services/imageGallery';
import { useLauncherStore } from './launcherStore';

export const useGalleryCacheStore = defineStore('galleryCache', () => {
  const launcherStore = useLauncherStore();
  const progress = ref<GalleryIndexProgress>({
    stage: 'Preparing image index',
    processed: 0,
    total: 0
  });
  const isRebuilding = ref(false);
  const isDialogOpen = ref(false);
  const indexedCount = ref(0);
  const error = ref('');

  const percent = computed(() =>
    progress.value.total > 0
      ? Math.round((progress.value.processed / progress.value.total) * 100)
      : 0
  );

  void onGalleryIndexProgress((next) => {
    progress.value = next;
  }).catch(() => {});

  function resetProgress(stage: string) {
    progress.value = { stage, processed: 0, total: 0 };
  }

  async function clearAndRebuild() {
    if (isRebuilding.value) return;
    isRebuilding.value = true;
    isDialogOpen.value = launcherStore.hasComfyDirectory;
    indexedCount.value = 0;
    error.value = '';
    resetProgress('Clearing thumbnail cache');
    try {
      await clearGalleryCache();
      if (launcherStore.hasComfyDirectory) {
        const images = await prepareOutputGallery(
          launcherStore.config.workingDir,
          launcherStore.launchArgs
        );
        indexedCount.value = images.length;
      }
    } catch (reason) {
      error.value = String(reason);
    } finally {
      isRebuilding.value = false;
    }
  }

  return {
    progress,
    percent,
    isRebuilding,
    isDialogOpen,
    indexedCount,
    error,
    resetProgress,
    clearAndRebuild
  };
});
